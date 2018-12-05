import _ from 'lodash';
import * as d3 from 'd3';
import {unwrapFeature, filterSprints, sprintsToFeatures} from '../data';
import Chart from './Chart';

export default class BarChart extends Chart {
    orderSprints(sprints) {
        return sprints;
    }

    requestConfig() {
        return _.assign({}, super.requestConfig(), {
            expressions: true
        });
    }

    format(data, state, resolve) {
        const { projects, newProjects, newCharts } =
            this.createCharts(data, state, {
                y0: true,
                y2: true
            });

        newProjects.insert("g", "g.legend")
            .classed("features", true);

        this.createFocus(newProjects);

        const updateProjects = newCharts.merge(projects).order()
            .select("g");

        this.createFeatures(state, updateProjects, {
            stacks: true
        });

        const t = d3.transition().duration(1000)
            .on("end", () => resolve());

        this.updateLegends(state, updateProjects, {t: t});

        updateProjects.each(
            (d, i, nodes) => this.updateChart(state, d3.select(nodes[i]), d, i, t)
        );
    }

    updateChart(state, chart, d, i, t) {
        const sprints = filterSprints(state, d.sprints);
        const data = sprintsToFeatures(sprints, state.features.visible,
            state.features.visible, {unwrap: true}
        );

        const {lowFeatures, highFeatures, lowData, highData, middleMagnitude} =
            this.splitMagnitudes(state, data);

        const width = this.width - this.legendWidths[i] -
            (!_.isEmpty(highData) ? this.margin.yAxis + this.textHeight : 0);
        var x = d3.scaleBand()
            .range([0, width])
            .domain(_.range(sprints.length))
            .paddingInner(1 / (state.features.visible.size * 2));

        const extent = d3.extent(_.flatten(lowData));
        var y = d3.scaleLinear()
            .rangeRound([this.height, 0])
            .domain([Math.min(0, extent[0]), extent[1]]);

        var y2 = !_.isEmpty(highData) ? d3.scaleLinear()
            .rangeRound([this.height, 0])
            .domain([
                Math.pow(10, middleMagnitude), _.max(_.flatten(highData))
            ]) : null;

        this.updateFocus(chart, d, state, sprints, x, y, {
            range: () => d3.scaleLinear()
                .range(_.range(x.bandwidth() / 2, width + x.bandwidth() / 2, x.step()))
                .domain(_.range(sprints.length)),
            select: (i, j, target) => {
                const features = _.map(data, f => f.sprints[i]);
                const bandPos = target[0] % x.step();
                const pos = bandPos / (x.bandwidth() / state.features.visible.size);
                const idx = Math.floor(pos);
                return features[idx];
            }
        });
        this.updateAxes(chart, state, d, x, y, {
            t: t,
            y: {
                axis: d3.axisLeft(y),
                label: lowFeatures.size === 1 ?
                    this.locales.retrieve(this.localization.descriptions,
                        lowFeatures.first()
                    ) :
                    this.locales.message("features-header")
            },
            y0: true,
            y2: y2 !== null ? {
                axis: d3.axisRight(y2),
                label: highFeatures.size === 1 ?
                    this.locales.retrieve(this.localization.descriptions,
                        highFeatures.first()
                    ) :
                    this.locales.message("features-header")
            } : {label: ""}
        });

        const yZero = y(0);
        chart.select("g.features").selectAll("g.feature")
            .each((f, j, features) => {
                const data = state.features.visible.includes(f.feature_key) ||
                    f.stack !== null ? unwrapFeature(f.sprints) : [];
                const feature = d3.select(features[j]);
                const bars = feature.selectAll("rect").data(data);

                const yVal = highFeatures.includes(f.feature_key) ? y2 : y;
                bars.exit().remove();
                bars.enter().append("rect")
                    .attr("y", yZero)
                    .attr("height", 0)
                    .style("fill", this.scheme[j % this.scheme.length])
                    .merge(bars)
                    .transition()
                    .duration(t.duration() / 2)
                    .attr("x", (g, i) => x(i) + x.bandwidth() / state.features.visible.size * f.visible_index)
                    .attr("width", x.bandwidth() / state.features.visible.size)
                    .transition()
                    .duration(t.duration() / 2)
                    .attr("y", (g, i) => {
                        if (g < 0) {
                            return yZero;
                        }
                        if (f.stack !== null) {
                            return yVal(g + f.stack[i]);
                        }
                        return yVal(g);
                    })
                    .attr("height", (g, i) => {
                        if (typeof g === "undefined" || g === null) {
                            return 0;
                        }
                        if (f.stack !== null) {
                            return Math.abs(yVal(f.stack[i]) - yVal(g + f.stack[i]));
                        }
                        return Math.abs(yZero - yVal(g));
                    })
                    .style("fill", this.scheme[j % this.scheme.length]);
            });
    }
}
