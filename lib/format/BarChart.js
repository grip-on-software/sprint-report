import _ from 'lodash';
import * as d3 from 'd3';
import {filterSprints, sprintsToFeatures} from '../data';
import Chart from './Chart';

export default class BarChart extends Chart {
    orderSprints(sprints) {
        return sprints;
    }

    format(data, state, resolve) {
        var {projects, newProjects, newCharts} = this.createCharts(data);

        newProjects.insert("g", "g.legend")
            .classed("features", true);

        this.createFocus(newProjects);

        const updateProjects = newCharts.merge(projects).order()
            .select("g");

        this.updateLegends(state, updateProjects);

        this.createFeatures(state, updateProjects);

        const t = d3.transition().duration(1000)
            .on("end", () => resolve());
        updateProjects.each(
            (d, i, nodes) => this.updateChart(state, d3.select(nodes[i]), d, i, t)
        );
    }

    updateChart(state, chart, d, i, t) {
        const sprints = filterSprints(state, d.sprints);
        const data = sprintsToFeatures(sprints, state.features.visible);

        var x = d3.scaleBand()
            .range([0, this.width - this.legendWidths[i]])
            .domain(_.range(sprints.length))
            .paddingInner(1 / (state.features.visible.size * 2));

        var y = d3.scaleLinear()
            .rangeRound([this.height, 0])
            .domain(d3.extent(_.flatten(_.map(data, "sprints"))));

        this.updateFocus(chart, d, state, sprints, x, y, {
            range: () => d3.scaleLinear()
                .range(_.range(x.bandwidth() / 2, this.width + x.bandwidth() / 2, x.step()))
                .domain(_.range(sprints.length)),
            select: (i, j, target) => {
                const features = _.map(data, f => f.sprints[i]);
                const bandPos = target[0] % x.step();
                const pos = bandPos / (x.bandwidth() / state.features.visible.size);
                const idx = Math.floor(pos);
                return features[idx];
            }
        });
        this.updateAxes(chart, state, d, x, y);

        chart.select("g.features").selectAll("g.feature")
            .each((f, j, features) => {
                const feature = d3.select(features[j]);
                const bars = feature.selectAll("rect")
                    .data(state.features.visible.includes(f.feature_key) ?
                        f.sprints : []
                    );

                bars.exit().remove();
                bars.enter().append("rect")
                    .attr("y", this.height)
                    .attr("height", 0)
                    .style("fill", this.scheme[j % this.scheme.length])
                    .merge(bars)
                    .transition()
                    .duration(500)
                    .attr("x", (g, i) => x(i) + x.bandwidth() / state.features.visible.size * f.visible_index)
                    .attr("width", x.bandwidth() / state.features.visible.size)
                    .transition()
                    .duration(500)
                    .attr("y", g => y(g))
                    .attr("height", g => this.height - y(g))
                    .style("fill", this.scheme[j % this.scheme.length]);
            });
    }
}
