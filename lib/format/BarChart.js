/**
 * Bar chart format for the sprint report.
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
import {unwrapFeature, sprintsToFeatures} from '../data';
import Chart from './Chart';

/**
 * Bar chart output format.
 */
export default class BarChart extends Chart {
    orderSprints(sprints) {
        return sprints;
    }

    requestConfig() {
        return _.assign({}, super.requestConfig(), {
            expressions: true,
            future: true
        });
    }

    format(data, state, resolve) {
        const { projects, newProjects, newCharts } =
            this.createCharts(data, state, {
                y0: true,
                y2: true,
                future: true
            });

        newProjects.insert("g", "g.legend")
            .classed("features", true);

        this.createFocus(newProjects);

        const updateProjects = newCharts.merge(projects).order()
            .select("g");

        const { select } = this.updateFeatures(state, updateProjects);
        const t = this.makeTransition(data, resolve);

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
        const x = d3.scaleBand()
            .range([0, width])
            .domain(_.range(d.sprints.length))
            .paddingInner(1 / (state.features.visible.size * 2));

        const extent = d3.extent(_.flatten(lowData));
        const y = d3.scaleLinear()
            .rangeRound([this.height, 0])
            .domain([Math.min(0, extent[0]), extent[1]]);

        const y2 = !_.isEmpty(highData) ? d3.scaleLinear()
            .rangeRound([this.height, 0])
            .domain([
                Math.pow(10, middleMagnitude), _.max(_.flatten(highData))
            ]) : null;

        this.updateFocus(chart, d, state, d.sprints, {
            x, y,
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
        this.updateAxes(chart, state, d, {x, y}, {
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
            } : {},
            future: _.findLastIndex(d.sprints, sprint => !sprint.future) + 1 || 0
        });

        const yZero = y(0);
        chart.select("g.features").selectAll("g.feature")
            .each((f, j, features) => {
                this.updateFeature(state, f, j, d3.select(features[j]), {
                    x: x,
                    y0: yZero,
                    y: highFeatures.includes(f.visible_key) ? y2 : y,
                    t: t
                });
            });
    }

    /**
     * Update the bars for a feature.
     */
    updateFeature(state, f, j, feature, config) {
        const data = state.features.visible.includes(f.visible_key) ?
            unwrapFeature(f.sprints) : [];
        const bars = feature.selectAll("rect").data(data);
        const barWidth = config.x.bandwidth() / state.features.visible.size;
        const barOffset = barWidth * f.visible_index;

        bars.exit().remove();
        bars.enter().append("rect")
            .attr("y", (g, i) => f.stack !== null && this.defined(f.stack[i]) ?
                config.y(f.stack[i]) : config.y0
            )
            .attr("height", 0)
            .style("fill", this.scheme[j % this.scheme.length])
            .merge(bars)
            .transition()
            .duration(config.t.duration() / 2)
            .attr("x", (g, i) => config.x(i) + barOffset)
            .attr("width", barWidth)
            .style("fill", this.scheme[j % this.scheme.length])
            .transition()
            .duration(config.t.duration() / 2)
            .attr("y", (g, i) => {
                if (g < 0 || !this.defined(g)) {
                    return config.y0;
                }
                if (f.stack !== null && this.defined(f.stack[i])) {
                    return config.y(g + f.stack[i]);
                }
                return config.y(g);
            })
            .attr("height", (g, i) => {
                if (!this.defined(g)) {
                    return 0;
                }
                if (f.stack !== null) {
                    return Math.abs(Math.min(this.height, config.y(f.stack[i])) - config.y(g + f.stack[i]));
                }
                return Math.abs(config.y0 - config.y(g));
            });
    }
}
