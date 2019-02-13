import _ from 'lodash';
import * as d3 from 'd3';
import {unwrapFeature, sprintsToFeatures} from '../data';
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

        const t = d3.transition().duration(1000)
            .on("end", () => resolve());

        const { select } = this.updateFeatures(state, updateProjects);

        this.updateStackedLegends(state, updateProjects, select, t);

        updateProjects.each(
            (d, i, nodes) => this.updateChart(state, d3.select(nodes[i]), d, i, t)
        );
    }

    updateFeatures(state, charts) {
        return this.createFeatures(state, charts, {
            stacks: true
        });
    }

    updateChart(state, chart, d, i, t) {
        const data = sprintsToFeatures(d.sprints, state.features.visible,
            state.features.visible, {unwrap: true}
        );

        const {lowFeatures, highFeatures, lowData, highData, middleMagnitude} =
            this.splitMagnitudes(state, data);

        const width = this.width - this.legendWidths[i] -
            (!_.isEmpty(highData) ? this.margin.yAxis + this.textHeight : 0);
        var x = d3.scaleBand()
            .range([0, width])
            .domain(_.range(d.sprints.length))
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

        this.updateFocus(chart, d, state, d.sprints, x, y, {
            stacks: () => true,
            range: () => d3.scaleLinear()
                .range(_.range(x.bandwidth() / 2, width + x.bandwidth() / 2, x.step()))
                .domain(_.range(d.sprints.length)),
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
                label: {
                    features: lowFeatures
                },
            },
            y0: true,
            y2: y2 !== null ? {
                axis: d3.axisRight(y2),
                label: {
                    features: highFeatures,
                    text: this.locales.message("features-header")
                },
            } : {}
        });

        const yZero = y(0);
        chart.select("g.features").selectAll("g.feature")
            .each((f, j, features) => {
                this.updateFeature(state, f, j, d3.select(features[j]), {
                    x: x,
                    y0: yZero,
                    y: highFeatures.includes(f.feature_key) ? y2 : y
                }, t);
            });
    }

    updateFeature(state, f, j, feature, config, t) {
        const data = state.features.visible.includes(f.visible_key) ?
            unwrapFeature(f.sprints) : [];
        const bars = feature.selectAll("rect").data(data);
        const barWidth = config.x.bandwidth() / state.features.visible.size;
        const barOffset = barWidth * f.visible_index;

        bars.exit().remove();
        bars.enter().append("rect")
            .attr("y",
                (g, i) => f.stack !== null ? config.y(f.stack[i]) : config.y0
            )
            .attr("height", 0)
            .style("fill", this.scheme[j % this.scheme.length])
            .merge(bars)
            .transition()
            .duration(t.duration() / 2)
            .attr("x", (g, i) => config.x(i) + barOffset)
            .attr("width", barWidth)
            .style("fill", this.scheme[j % this.scheme.length])
            .transition()
            .duration(t.duration() / 2)
            .attr("y", (g, i) => {
                if (g < 0) {
                    return config.y0;
                }
                if (f.stack !== null) {
                    return config.y(g + f.stack[i]);
                }
                return config.y(g);
            })
            .attr("height", (g, i) => {
                if (!this.defined(g)) {
                    return 0;
                }
                if (f.stack !== null) {
                    return Math.abs(config.y(f.stack[i]) - config.y(g + f.stack[i]));
                }
                return Math.abs(config.y0 - config.y(g));
            });
    }
}
