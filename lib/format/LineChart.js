import _ from 'lodash';
import * as d3 from 'd3';
import moment from 'moment';
import {unwrapFeature, filterSprints, sprintsToFeatures} from '../data';
import Chart from './Chart';

const linspace = function(start, stop, nsteps) {
    const delta = (stop - start) / (nsteps - 1);
    return d3.range(nsteps).map(i => start + i * delta);
};

export default class LineChart extends Chart {
    orderSprints(sprints) {
        return sprints;
    }

    format(data, state, resolve) {
        const { projects, newProjects, newCharts } =
            this.createCharts(data, state, {y0: true, y2: true});

        newProjects.append("g")
            .classed("features", true);

        const { focus } = this.createFocus(newProjects);

        focus.append("circle")
            .attr("r", 6);

        focus.append("line")
            .attr("y1", 5)
            .attr("y2", this.height);

        const updateProjects = newCharts.merge(projects).order()
            .select("g");

        const t = d3.transition().duration(1000)
            .on("end", () => resolve());
        this.updateLegends(state, updateProjects, {t: t});

        const { newFeatures } = this.createFeatures(state, updateProjects);

        newFeatures.append("path")
            .attr("fill", "none")
            .attr("stroke-linejoin", "round")
            .attr("stroke-linecap", "round")
            .attr("stroke-width", 1.5);

        updateProjects.each(
            (d, i, nodes) => this.updateChart(state, d3.select(nodes[i]), d, i, t)
        );
    }

    updateChart(state, chart, d, i, t) {
        const sprints = filterSprints(state, d.sprints);
        const data = sprintsToFeatures(sprints, state.features.visible,
            state.features.visible, {unwrap: true}
        );
        const dates = _.map(sprints, sprint => moment(sprint.start_date));

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

        this.updateFocus(chart, d, state, sprints, x, y, {
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
            focus: (focusHolder, i, pos) => {
                const missing = typeof sprints[i] === "undefined";
                const visibility = missing ? "hidden" : null;
                const datePos = missing ? 0 : x(dates[i]);
                focusHolder.select("circle")
                    .attr("visibility", visibility)
                    .attr("cx", datePos)
                    .attr("cy", pos);
                focusHolder.select("line")
                    .attr("visibility", visibility)
                    .attr("x1", datePos)
                    .attr("x2", datePos)
                    .attr("y1", pos + 2);
            }
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
            y0: true
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
                    y: pick(f.feature_key, y, y2)
                }, t);
            });
    }

    updateFeature(dates, f, j, feature, config, t) {
        const sprints = unwrapFeature(f.sprints);
        feature.select("path")
            .attr("stroke", this.scheme[j % this.scheme.length])
            .attr("d", config.line(sprints))
            .transition(t)
            .attrTween("stroke-dasharray", function() {
                const length = this.getTotalLength();
                return d3.interpolateString(`0,${length}`, `${length},${length}`);
            });

        const points = feature.selectAll("circle")
            .data(sprints);

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
            .attr("cy", g => config.y(g))
            .attr("fill-opacity", 0)
            .transition(t)
            .attr("fill-opacity", 1);
    }
}
