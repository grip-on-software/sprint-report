import _ from 'lodash';
import * as d3 from 'd3';
import moment from 'moment';
import {zipFeature, sprintsToFeatures} from '../data';
import Chart from './Chart';

export default class LineChart extends Chart {
    orderSprints(sprints) {
        return sprints;
    }

    requestConfig() {
        return _.assign({}, super.requestConfig(), {
            future: true
        });
    }

    format(data, state, resolve) {
        const { projects, newProjects, newCharts } =
            this.createCharts(data, state, {y0: true, y2: true, future: true});

        newProjects.append("g")
            .classed("features", true);

        this.createLineFocus(newProjects);

        const updateProjects = newCharts.merge(projects).order()
            .select("g");

        const t = this.makeTransition(data, resolve);
        this.updateLegends(state, updateProjects, {t: t});

        const { newFeatures } = this.createFeatures(state, updateProjects);

        updateProjects.each(
            (d, i, nodes) => this.updateChart(state, d3.select(nodes[i]), d, i, t)
        );
    }

    updateChart(state, chart, d, i, t) {
        const data = sprintsToFeatures(d.sprints, state.features.visible,
            state.features.visible, {unwrap: true}
        );
        const dates = _.map(d.sprints, sprint => moment(sprint.start_date));

        const {lowFeatures, highFeatures, lowData, highData, middleMagnitude} =
            this.splitMagnitudes(state, data);
        const pick = (key, one, two) => highFeatures.includes(key) ? two : one;

        const width = this.width - this.legendWidths[i] -
            (!_.isEmpty(highData) ? this.margin.yAxis + this.textHeight : 0);
        var x = d3.scaleTime()
            .range([0, width])
            .domain(d3.extent(dates));

        var y = d3.scaleLinear()
            .rangeRound([this.height, 0])
            .domain(d3.extent(_.flatten(lowData)));

        var y2 = !_.isEmpty(highData) ? d3.scaleLinear()
            .rangeRound([this.height, 0])
            .domain([
                Math.pow(10, middleMagnitude), _.max(_.flatten(highData))
            ]) : null;

        this.updateFocus(chart, d, state, d.sprints, x, y, {
            range: () => x,
            mouseIndex: x => {
                const i = _.sortedIndex(dates, x);
                return x - dates[i-1] < dates[i] - x ? i - 1 : i;
            },
            select: (i, j, target) => {
                const feature = _.minBy(data, f => {
                    const yVal = pick(f.feature_key, y, y2);
                    return Math.abs(yVal(f.sprints[i]) - target[1]);
                });
                if (!feature) {
                    return undefined;
                }
                return {
                    i, index: i,
                    scale: pick(feature.feature_key, y, y2),
                    feature: feature.sprints[i]
                };
            },
            focus: (focusHolder, i, pos, feature) =>
                this.updateLineFocus(focusHolder, i, pos, feature, {
                    sprints: d.sprints,
                    dates: dates,
                    x: x
                })
        });

        const futureStart = _.isEmpty(d.sprints) ? false :
            moment((_.findLast(d.sprints, sprint => !sprint.future) || d.sprints[0]).start_date);
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

        chart.select("g.features").selectAll("g.feature")
            .each((f, j, features) => {
                this.updateFeature(dates, f, j, d3.select(features[j]), {
                    line: pick(f.feature_key, line, line2),
                    x: x,
                    y: pick(f.feature_key, y, y2),
                    future: futureStart
                }, t);
            });
    }

    updateFeature(dates, f, j, feature, config, t) {
        const sprints = zipFeature(f.sprints);
        const groups = feature.selectAll("g").data(sprints);
        groups.exit().remove();
        const newGroups = groups.enter().append("g");
        newGroups.append("path")
            .attr("fill", "none")
            .attr("stroke-linejoin", "round")
            .attr("stroke-linecap", "round")
            .attr("stroke-width", 1.5)
            .merge(groups.select("path"))
            .attr("stroke", (d, i) => this.scheme[(j + sprints.length - 1 - i) % this.scheme.length])
            .attr("d", d => config.line(d))
            .transition(t)
            .attrTween("stroke-dasharray", function(d, i) {
                const length = this.getTotalLength();
                return d3.interpolateString(`0,${length}`, `${length},${length}`);
            });

        const points = newGroups.merge(groups)
            .selectAll("circle")
            .data(d => d);

        points.exit().remove();
        const point = points.enter()
            .append("circle")
            .attr("r", 4)
            .attr("stroke", "#ffffff")
            .attr("stroke-width", "0.1rem");

        points.merge(point)
            .attr("fill", this.scheme[j % this.scheme.length])
            .classed("is-hidden", g => !this.defined(g))
            .attr("cx", (g, i) => config.x(dates[i]))
            .attr("cy", g => this.defined(g) ? config.y(g) : 0)
            .attr("fill-opacity", 0)
            .transition(t)
            .attr("fill-opacity", 1);
    }
}
