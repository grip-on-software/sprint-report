import _ from 'lodash';
import * as d3 from 'd3';
import {filterSprints, sprintsToFeatures} from '../data';
import Chart from './chart';

const linspace = function(start, stop, nsteps) {
    const delta = (stop - start) / (nsteps - 1);
    return d3.range(nsteps).map(i => start + i * delta);
};

export default class LineChart extends Chart {
    orderSprints(sprints) {
        return sprints;
    }

    format(data, state, resolve) {
        var {projects, newProjects, newCharts} = this.createCharts(data);

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

        var x = d3.scaleOrdinal()
            .range(linspace(0, this.width - this.legendWidths[i], sprints.length))
            .domain(_.range(sprints.length));

        var y = d3.scaleLinear()
            .rangeRound([this.height, 0])
            .domain(d3.extent(_.flatten(_.map(data, "sprints"))));

        this.updateFocus(chart, d, state, sprints, x, y, {
            select: (i, j) => {
                const features = _.map(data, f => f.sprints[i]);
                return _.minBy(features, g => Math.abs(g - j));
            },
            focus: (focusHolder, i, j) => {
                focusHolder.select("circle")
                    .attr("cx", x(i))
                    .attr("cy", j);
                focusHolder.select("line")
                    .attr("x1", x(i))
                    .attr("x2", x(i))
                    .attr("y1", j + 2);
            }
        });

        this.updateAxes(chart, state, d, x, y);

        const line = d3.line()
            .defined(g => g !== undefined && g !== null)
            .x((g, i) => x(i))
            .y(g => y(g))
            .curve(d3.curveMonotoneX);

        chart.select("g.features").selectAll("g.feature")
            .each((f, j, features) => {
                const feature = d3.select(features[j]);
                feature.select("path")
                    .attr("stroke", this.scheme[j % this.scheme.length])
                    .attr("d", line(f.sprints))
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
                    .attr("cy", g => y(g))
                    .attr("fill-opacity", 0)
                    .transition(t)
                    .attr("fill-opacity", 1);
            });
    }
}
