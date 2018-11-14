import _ from 'lodash';
import * as d3 from 'd3';
import {filterSprints, sprintsToFeatures} from '../data';
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
        var {projects, newProjects, newCharts} = this.createCharts(data, {
            y2: true
        });

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

        this.updateLegends(state, updateProjects);

        const newFeatures = this.createFeatures(state, updateProjects);

        newFeatures.append("path")
            .attr("fill", "none")
            .attr("stroke-linejoin", "round")
            .attr("stroke-linecap", "round")
            .attr("stroke-width", 1.5);

        const t = d3.transition().duration(1000)
            .on("end", () => resolve());
        updateProjects.each(
            (d, i, nodes) => this.updateChart(state, d3.select(nodes[i]), d, i, t)
        );
    }

    updateChart(state, chart, d, i, t) {
        const sprints = filterSprints(state, d.sprints);
        const data = sprintsToFeatures(sprints, state.features.visible);

        const {lowFeatures, highFeatures, lowData, highData, middleMagnitude} =
            this.splitMagnitudes(state, data);

        const width = this.width - this.legendWidths[i] -
            (!_.isEmpty(highData) ? this.margin.yAxis : 0);
        var x = d3.scaleOrdinal()
            .range(linspace(0, width, sprints.length))
            .domain(_.range(sprints.length));

        var y = d3.scaleLinear()
            .rangeRound([this.height, 0])
            .domain(d3.extent(_.flatten(lowData)));

        var y2 = !_.isEmpty(highData) ? d3.scaleLinear()
            .rangeRound([this.height, 0])
            .domain([
                Math.pow(10, middleMagnitude), _.max(_.flatten(highData))
            ]) : null;

        this.updateFocus(chart, d, state, sprints, x, y, {
            select: (i, j, target) => {
                const feature = _.minBy(data,
                    f => highFeatures.includes(f.feature_key) ?
                        Math.abs(y2(f.sprints[i]) - target[1]) :
                        Math.abs(y(f.sprints[i]) - target[1])
                );
                return feature ? {
                    i, index: i,
                    scale: highFeatures.includes(feature.feature_key) ? y2 : y,
                    feature: feature.sprints[i]
                } : undefined;
            },
            focus: (focusHolder, i, pos) => {
                const missing = typeof sprints[i] === "undefined";
                focusHolder.select("circle")
                    .attr("visibility", missing ? "hidden" : null)
                    .attr("cx", x(i))
                    .attr("cy", pos);
                focusHolder.select("line")
                    .attr("visibility", missing ? "hidden" : null)
                    .attr("x1", x(i))
                    .attr("x2", x(i))
                    .attr("y1", pos + 2);
            }
        });

        this.updateAxes(chart, state, d, x, y, {
            y: {
                axis: d3.axisLeft(y),
                label: lowFeatures.size === 1 ?
                    this.locales.retrieve(this.localization.descriptions,
                        lowFeatures.first()
                    ) :
                    this.locales.message("features-header")
            },
            y2: y2 !== null ? {
                axis: d3.axisRight(y2),
                label: highFeatures.size === 1 ?
                    this.locales.retrieve(this.localization.descriptions,
                        highFeatures.first()
                    ) :
                    this.locales.message("features-header")
            } : {label: ""}
        });

        const line = d3.line()
            .defined(g => g !== undefined && g !== null)
            .x((g, i) => x(i))
            .y(g => y(g))
            .curve(d3.curveMonotoneX);
        const line2 = y2 === null ? null : d3.line()
            .defined(g => g !== undefined && g !== null)
            .x((g, i) => x(i))
            .y(g => y2(g))
            .curve(d3.curveMonotoneX);

        chart.select("g.features").selectAll("g.feature")
            .each((f, j, features) => {
                const feature = d3.select(features[j]);
                feature.select("path")
                    .attr("stroke", this.scheme[j % this.scheme.length])
                    .attr("d", highFeatures.includes(f.feature_key) ?
                        line2(f.sprints) : line(f.sprints)
                    )
                    .transition(t)
                    .attrTween("stroke-dasharray", function() {
                        const length = this.getTotalLength();
                        return d3.interpolateString(`0,${length}`, `${length},${length}`);
                    });

                const points = feature.selectAll("circle")
                    .data(f.sprints);

                points.exit().remove();
                const point = points.enter()
                    .append("circle")
                    .attr("r", 4)
                    .attr("stroke", "#ffffff")
                    .attr("stroke-width", "0.1rem");

                points.merge(point)
                    .attr("fill", this.scheme[j % this.scheme.length])
                    .classed("is-hidden", g => g === undefined || g === null)
                    .attr("cx", (g, i) => x(i))
                    .attr("cy", g => highFeatures.includes(f.feature_key) ?
                        y2(g) : y(g)
                    )
                    .attr("fill-opacity", 0)
                    .transition(t)
                    .attr("fill-opacity", 1);
            });
    }
}
