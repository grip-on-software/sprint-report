/**
 * Line chart format for the sprint report.
 *
 * Copyright 2017-2020 ICTU
 * Copyright 2017-2022 Leiden University
 * Copyright 2017-2023 Leon Helwerda
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import _ from 'lodash';
import * as d3 from 'd3';
import * as d3plus from 'd3plus-text';
import moment from 'moment';
import {zipFeature, sprintsToFeatures} from '../data';
import Chart from './Chart';
import {FILL_OPACITY_ATTR, STROKE_WIDTH_ATTR} from '../attrs';

const DENSITY_OPACITY = 0.425;

/**
 * Line chart output format.
 */
export default class LineChart extends Chart {
    orderSprints(sprints) {
        return sprints;
    }

    requestConfig() {
        return _.assign({}, super.requestConfig(), {
            future: true
        });
    }

    /**
     * Create a sample for a row within the legends.
     */
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

    /**
     * Fill a sample for a row within the legend with proper color and filling.
     */
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

    /**
     * Determine an array of objects that describe extra rows for the legends.
     */
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

        // Group elements for the lines in the chart, plus extra text for
        // prediction likelihoods of future values
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

    updateFocus(chart, d, state, data, config) {
        super.updateFocus(chart, d, state, d.sprints, {
            x: config.x,
            y: config.y,
            range: () => config.x,
            mouseIndex: x => {
                const i = _.sortedIndex(config.dates, x);
                return x - config.dates[i-1] < config.dates[i] - x ? i - 1 : i;
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
                    dates: config.dates,
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
        const x = d3.scaleTime()
            .range([0, width])
            .domain([dates[0], nanMax(
                futureDates[futureDates.length - 1], dates[dates.length - 1]
            )]);

        const y = d3.scaleLinear()
            .rangeRound([this.height, 0])
            .domain(d3.extent(_.flatten(lowData)));

        const y2 = !_.isEmpty(highData) ? d3.scaleLinear()
            .rangeRound([this.height, 0])
            .domain([
                Math.pow(10, middleMagnitude), _.max(_.flatten(highData))
            ]) : null;

        const futureIndex = _.isEmpty(d.sprints) ? -1 :
            _.findLastIndex(d.sprints, sprint => !sprint.future) || 0;
        const futureStart = futureIndex === -1 ? false :
            moment(d.sprints[futureIndex].start_date);

        this.updateFocus(chart, d, state, data, {
            dates: dates,
            x: x,
            y: y,
            y2: y2,
            pick: pick,
            futureIndex: futureIndex
        });

        this.updateAxes(chart, state, d, {x, y}, {
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
                this.updateFeatureLine(d, f, j, d3.select(features[j]), {
                    dates: dates,
                    t: t,
                    line: pick(f.feature_key, line, line2),
                    x: x,
                    y: pick(f.feature_key, y, y2),
                    future: futureStart,
                    futureIndex: futureIndex
                });
            });
        chart.select("g.features.text").selectAll("g.feature")
            .each((f, j, features) => {
                this.updateFeatureText(d, f, j, d3.select(features[j]), {
                    x: x,
                    y: pick(f.feature_key, y, y2),
                    future: futureStart,
                    futureIndex: futureIndex,
                    futureDates: futureDates,
                    i: i,
                    t: t
                });
            });
    }

    /**
     * Update a text and possibly an associated density line that describe
     * prediction likelihoods for future sprints.
     */
    updateFeatureText(d, f, j, feature, config) {
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
        let zero = findDensity(lowest);
        if (zero === -1) {
            zero = config.futureDates.length - 1;
        }

        let texts = [];
        if (this.defined(lowest[zero])) {
            texts = texts.concat(wrap(
                this.locales.message("prediction-error-probability", [
                    config.futureDates[zero].format('LL'),
                    d3.format(".1~%")(lowest[zero])
                ])
            ).lines);
        }
        const text = feature.selectAll("text").data(texts);
        text.exit().remove();
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
            this.createLine(path.enter(), path, j, count, {t: config.t, line})
                .attr("stroke-opacity", DENSITY_OPACITY);
        }
    }

    /**
     * Create a line for a feature or a density function.
     */
    createLine(enter, update, j, count, config) {
        const newPath = enter.append("path")
            .attr("fill", "none")
            .attr("stroke-linejoin", "round")
            .attr("stroke-linecap", "round")
            .attr(STROKE_WIDTH_ATTR, 1.5);
        newPath.merge(update)
            .attr("stroke", (d, i) => this.scheme[(j + count - 1 - i) % this.scheme.length])
            .attr("d", d => config.line(d))
            .transition(config.t)
            .attrTween("stroke-dasharray", function(d, i) {
                const length = this.getTotalLength();
                return d3.interpolateString(`0,${length}`, `${length},${length}`);
            });
        return newPath;
    }

    /**
     * Create or update points that indicate values at start dates of sprints
     * for a feature.
     */
    createPoints(selection, index, config) {
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
            .attr("x", (g, i) => config.x(config.dates[i]) - 4)
            .attr("y", g => this.defined(g) ? config.y(g) - 4 : 0)
            .attr(FILL_OPACITY_ATTR, 0)
            .transition(config.t)
            .attr(FILL_OPACITY_ATTR, 1);
        return point;
    }

    /**
     * Create or update lines of features, including points at start dates of
     * sprints.
     */
    updateFeatureLine(d, f, j, feature, config) {
        const sprints = zipFeature(f.sprints);
        const groups = feature.selectAll("g").data(sprints);
        groups.exit().remove();
        const newGroups = groups.enter().append("g");
        this.createLine(newGroups, groups.select("path"), j, sprints.length,
            config
        );

        newGroups.merge(groups).each((d, k, nodes) => {
            const index = j + (sprints.length - 1 - k);
            this.createPoints(d3.select(nodes[k]), index, config);
        });
    }
}
