import _ from 'lodash';
import * as d3 from 'd3';
import * as d3plus from 'd3plus-text';
import moment from 'moment';
import {zipFeature, sprintsToFeatures} from '../data';
import Chart from './Chart';
import {FILL_OPACITY_ATTR, STROKE_WIDTH_ATTR} from '../attrs';

const DENSITY_OPACITY = 0.425;

export default class LineChart extends Chart {
    orderSprints(sprints) {
        return sprints;
    }

    requestConfig() {
        return _.assign({}, super.requestConfig(), {
            future: true
        });
    }

    legendSample(legend, extra=false) {
        const group = legend.append("g");
        if (extra) {
            group.append("rect")
                .attr("x", -20)
                .attr("y", -12)
                .attr("width", 24)
                .attr("height", 20)
                .attr("fill", "url(#future-fill)");
        }
        group.append("rect")
            .classed("sample-line", true)
            .attr("x", -18)
            .attr("y", -6)
            .attr("width", 20)
            .attr("height", 2);
        group.append("use")
            .attr("x", -12)
            .attr("y", -9);
        return group;
    }

    legendColor(sample, i=null, density=false) {
        const scheme = i !== null ?
            this.scheme[i % this.scheme.length] :
            (d, i) => this.scheme[i % this.scheme.length];
        const line = sample.select(".sample-line").style("fill", scheme);
        if (density) {
            line.attr(FILL_OPACITY_ATTR, DENSITY_OPACITY);
        }
        else {
            sample.select("use")
                .attr("href", i !== null ?
                    this.patternRef(i) :
                    (d, i) => this.patternRef(i)
                )
                .attr("fill", scheme);
        }
    }

    buildExtraLegend(state) {
        if (state.sprints.first >= 0 || !this.localization.metadata.prediction) {
            return [];
        }
        return _.transform(this.localization.metadata.prediction,
            (extra, meta, key) => {
                if (!state.features.selected.has(key)) {
                    return;
                }
                _.forEach(meta, predict => {
                    if (predict.monte_carlo) {
                        const previous = extra[extra.length-1];
                        extra.push({
                            index: previous.key.endsWith('_density') ?
                                previous.index + 1 : 0,
                            key: `${predict.monte_carlo.name}_density`
                        });
                    }
                    else if (predict.reference) {
                        extra.push({
                            index: extra.length,
                            key: predict.reference
                        });
                    }
                });
            }, []
        );
    }

    format(data, state, resolve) {
        const { projects, newProjects, newCharts } =
            this.createCharts(data, state, {y0: true, y2: true, future: true});

        newProjects.insert("g", "g.legend")
            .classed("features lines", true);
        newProjects.insert("g", "g.legend")
            .classed("features text", true);

        this.createLineFocus(newProjects);

        const updateProjects = newCharts.merge(projects).order()
            .select("g");

        const t = this.makeTransition(data, resolve);
        const extra = this.buildExtraLegend(state);
        this.updateLegends(state, updateProjects, {
            t: t,
            hideLines: data => data.selected.size <= 1 && extra.length === 0,
            text: (d, extra) => {
                const key = d.key || d;
                if (key.endsWith("_density")) {
                    return this.locales.message("prediction-density-legend", [
                        this.locales.retrieve(this.localization.predictor,
                            key.replace(/_density$/, '')
                        )
                    ]);
                }
                return this.locales.retrieve(extra ?
                    this.localization.predictor :
                    this.localization.descriptions, key
                );
            },
            sample: legend => this.legendSample(legend),
            color: sample => this.legendColor(sample),
            extra: extra,
            sampleExtra: (d, i, legend) => this.legendColor(
                this.legendSample(legend, true),
                state.features.selected.size - 1 + extra[extra.length-1].index - d.index,
                d.key.endsWith("_density")
            )
        });

        this.createFeatures(state, updateProjects);

        updateProjects.each(
            (d, i, nodes) => this.updateChart(state, d3.select(nodes[i]), d, i, t)
        );
    }

    updateFocus(chart, d, state, dates, data, config) {
        super.updateFocus(chart, d, state, d.sprints, config.x, config.y, {
            range: () => config.x,
            mouseIndex: x => {
                const i = _.sortedIndex(dates, x);
                return x - dates[i-1] < dates[i] - x ? i - 1 : i;
            },
            select: (i, j, target) => {
                const feature = _.minBy(data, f => {
                    const yVal = config.pick(f.feature_key, config.y, config.y2);
                    return Math.abs(yVal(f.sprints[i]) - target[1]);
                });
                if (!feature) {
                    return undefined;
                }
                return {
                    i, index: i,
                    scale: config.pick(feature.feature_key, config.y, config.y2),
                    feature: feature.sprints[i]
                };
            },
            focus: (focusHolder, i, pos, feature) =>
                this.updateLineFocus(focusHolder, i, pos, feature, {
                    sprints: d.sprints,
                    dates: dates,
                    x: config.x
                }),
            augment: (features, index) => {
                if (index > config.futureIndex) {
                    state.features.selected.forEach(feature => {
                        if (!_.isEmpty(d.errors[`${feature}_density`])) {
                            features = features.concat(
                                _.map(d.errors[`${feature}_density`],
                                    (value, key) => [
                                        `${key}_density`,
                                        value[index-config.futureIndex-1]
                                    ]
                                )
                            );
                        }
                    });
                }
                return features;
            },
            format_augment: (key, value, node, index) => {
                if (key.endsWith('_density')) {
                    return this.locales.message("prediction-density", [
                        this.locales.retrieve(this.localization.predictor,
                            key.replace(/_density$/, '')
                        ),
                        this.formatUnitText(key, 100 * value, "%s%%")
                    ]);
                }
                return value;
            }
        });
    }

    updateChart(state, chart, d, i, t) {
        const data = sprintsToFeatures(d.sprints, state.features.visible,
            state.features.visible, {unwrap: true}
        );
        const dates = _.map(d.sprints, sprint => moment(sprint.start_date));
        const futureDates = _.map(
            _.slice(d.errors.date, 0, -state.sprints.first),
            date => this.localization.moment(date, "YYYY-MM-DD HH:mm:ss")
        );

        const {lowFeatures, highFeatures, lowData, highData, middleMagnitude} =
            this.splitMagnitudes(state, data);
        const pick = (key, one, two) => highFeatures.includes(key) ? two : one;

        const width = this.width - this.legendWidths[i] -
            (!_.isEmpty(highData) ? this.margin.yAxis + this.textHeight : 0);
        const nanMax = (a, b) => a > b ? a : b;
        var x = d3.scaleTime()
            .range([0, width])
            .domain([dates[0], nanMax(
                futureDates[futureDates.length - 1], dates[dates.length - 1]
            )]);

        var y = d3.scaleLinear()
            .rangeRound([this.height, 0])
            .domain(d3.extent(_.flatten(lowData)));

        var y2 = !_.isEmpty(highData) ? d3.scaleLinear()
            .rangeRound([this.height, 0])
            .domain([
                Math.pow(10, middleMagnitude), _.max(_.flatten(highData))
            ]) : null;

        const futureIndex = _.isEmpty(d.sprints) ? -1 :
            _.findLastIndex(d.sprints, sprint => !sprint.future) || 0;
        const futureStart = futureIndex === -1 ? false :
            moment(d.sprints[futureIndex].start_date);

        this.updateFocus(chart, d, state, dates, data, {
            x: x,
            y: y,
            y2: y2,
            pick: pick,
            futureIndex: futureIndex
        });

        this.updateAxes(chart, state, d, x, y, {
            x: {
                axis: d3.axisBottom(x),
                label: {
                    text: this.locales.attribute("sprint_meta", "start_date")
                }
            },
            y: {
                axis: d3.axisLeft(y),
                label: {
                    features: lowFeatures
                }
            },
            y2: y2 !== null ? {
                axis: d3.axisRight(y2),
                label: {
                    features: highFeatures,
                    text: this.locales.message("features-header")
                }
            } : {},
            y0: true,
            future: futureStart
        });

        const line = d3.line()
            .defined(this.defined)
            .x((g, i) => x(dates[i]))
            .y(g => y(g))
            .curve(d3.curveMonotoneX);
        const line2 = y2 === null ? null : d3.line()
            .defined(this.defined)
            .x((g, i) => x(dates[i]))
            .y(g => y2(g))
            .curve(d3.curveMonotoneX);

        chart.select("g.features.lines").selectAll("g.feature")
            .each((f, j, features) => {
                this.updateFeatureLine(dates, d, f, j, d3.select(features[j]), {
                    line: pick(f.feature_key, line, line2),
                    x: x,
                    y: pick(f.feature_key, y, y2),
                    future: futureStart,
                    futureIndex: futureIndex
                }, t);
            });
        chart.select("g.features.text").selectAll("g.feature")
            .each((f, j, features) => {
                this.updateFeatureText(dates, d, f, j, d3.select(features[j]), {
                    x: x,
                    y: pick(f.feature_key, y, y2),
                    future: futureStart,
                    futureIndex: futureIndex,
                    futureDates: futureDates,
                    i: i
                }, t);
            });
    }

    updateFeatureText(dates, d, f, j, feature, config, t) {
        if (!d.errors[`${f.feature_key}_probability`]) {
            feature.selectAll("text").data([]).exit().remove();
            feature.selectAll("path").data([]).exit().remove();
            return;
        }

        const wrap = d3plus.textWrap()
            .fontSize(12.8)
            .width(this.legendWidths[config.i]);

        const findDensity = density => _.findIndex(density,
            (c, i) => c === 1 || i === config.futureDates.length - 1
        );
        const lowest = _.isEmpty(d.errors[`${f.feature_key}_density`]) ? [] :
            _.maxBy(
                _.toArray(d.errors[`${f.feature_key}_density`]), findDensity
            );
        var zero = findDensity(lowest);
        if (zero === -1) {
            zero = config.futureDates.length - 1;
        }

        var texts = [];
        if (this.defined(lowest[zero])) {
            texts = texts.concat(wrap(
                this.locales.message("prediction-error-probability", [
                    config.futureDates[zero].format('LL'),
                    d3.format(".1~%")(lowest[zero])
                ])
            ).lines);
        }
        const text = feature.selectAll("text").data(texts);
        text.enter()
            .append("text")
            .style("font-size", ".8rem")
            .merge(text)
            .attr('x', this.width - this.legendWidths[config.i])
            .attr('y', (d, i) => this.legendHeights[config.i] + 0.8 * this.textHeight * i + 20)
            .text(d => d);

        if (d.errors[`${f.feature_key}_density`]) {
            const count = _.size(d.errors[`${f.feature_key}_density`]);
            const y = d3.scaleLinear()
                .rangeRound([this.height, 0])
                .domain([0, 1]);
            const line = d3.line()
                .defined((g, i) => i < config.futureDates.length && this.defined(g))
                .x((g, i) => config.x(config.futureDates[i]))
                .y(g => y(g))
                .curve(d3.curveMonotoneX);
            const path = feature.selectAll("path")
                .data(_.values(d.errors[`${f.feature_key}_density`]));
            this.createLine(path.enter(), path, t, j, count, line)
                .attr("stroke-opacity", DENSITY_OPACITY);
        }
    }

    createLine(enter, update, t, j, count, line) {
        const newPath = enter.append("path")
            .attr("fill", "none")
            .attr("stroke-linejoin", "round")
            .attr("stroke-linecap", "round")
            .attr(STROKE_WIDTH_ATTR, 1.5);
        newPath.merge(update)
            .attr("stroke", (d, i) => this.scheme[(j + count - 1 - i) % this.scheme.length])
            .attr("d", d => line(d))
            .transition(t)
            .attrTween("stroke-dasharray", function(d, i) {
                const length = this.getTotalLength();
                return d3.interpolateString(`0,${length}`, `${length},${length}`);
            });
        return newPath;
    }

    createPoints(selection, dates, x, y, index, t) {
        const points = selection.selectAll("use")
            .data(d => d);

        points.exit().remove();
        const point = points.enter()
            .append("use")
            .attr("stroke", "#ffffff")
            .attr(STROKE_WIDTH_ATTR, "0.1rem");

        points.merge(point)
            .attr("href", this.patternRef(index))
            .attr("fill", this.scheme[index % this.scheme.length])
            .classed("is-hidden", g => !this.defined(g))
            .attr("x", (g, i) => x(dates[i]) - 4)
            .attr("y", g => this.defined(g) ? y(g) - 4 : 0)
            .attr(FILL_OPACITY_ATTR, 0)
            .transition(t)
            .attr(FILL_OPACITY_ATTR, 1);
        return point;
    }

    updateFeatureLine(dates, d, f, j, feature, config, t) {
        const sprints = zipFeature(f.sprints);
        const groups = feature.selectAll("g").data(sprints);
        groups.exit().remove();
        const newGroups = groups.enter().append("g");
        this.createLine(newGroups, groups.select("path"), t, j, sprints.length,
            config.line
        );

        newGroups.merge(groups).each((d, k, nodes) => {
            const index = j + (sprints.length - 1 - k);
            this.createPoints(d3.select(nodes[k]), dates, config.x, config.y,
                index, t
            );
        });
    }
}
