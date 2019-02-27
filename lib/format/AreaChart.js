import _ from 'lodash';
import * as d3 from 'd3';
import moment from 'moment';
import {unwrap, unwrapFeature} from '../data';
import Chart from './Chart';

export default class AreaChart extends Chart {
    initialize() {
        super.initialize();
        this.select = [];
        this.stackFeatures = [];
    }

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
            .classed("features areas", true);
        newProjects.insert("g", "g.legend")
            .classed("features lines", true);

        this.createLineFocus(newProjects);

        const updateProjects = newCharts.merge(projects).order()
            .select("g");

        const { newFeatures, select } =
            this.updateFeatures(state, updateProjects);

        const stackIndexes = new Set(_.map(select,
            f => _.isArray(f) ? f[1] : null
        ));
        this.select = select;
        this.stackFeatures = _.filter(select, (f, i) => !stackIndexes.has(i));

        newFeatures.append("path")
            .classed("area", true);
        newFeatures.append("path")
            .classed("line", true)
            .attr("fill", "none")
            .attr("stroke-linejoin", "round")
            .attr("stroke-linecap", "round")
            .attr("stroke-width", 1.5);

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
        const dates = _.map(d.sprints, sprint => moment(sprint.start_date));

        const width = this.width - this.legendWidths[i];
        var x = d3.scaleTime()
            .range([0, width])
            .domain(d3.extent(dates));

        const maximum = _.max(_.map(d.sprints,
            s => _.sum(unwrapFeature(_.values(_.pick(s,
                Array.from(state.features.visible)
            ))))
        ));
        var y = d3.scaleLinear()
            .rangeRound([this.height, 0])
            .domain([0, maximum]);

        const stackOnly = _.filter(this.stackFeatures,
            f => state.features.visible.has(_.isArray(f) ? this.select[f[1]] : f)
        );
        const stackKeys = _.map(stackOnly,
            f => _.isArray(f) ? `${this.select[f[1]]}-${f[0]}` : `${f}-${f}`
        );

        const stack = d3.stack()
            .keys(_.map(stackOnly, f => _.isArray(f) ? f[0] : f))
            .value((d, key) => unwrap(d[key]));
        const stackValues = stack(d.sprints);
        const stacks = _.zipObject(stackKeys, stackValues);

        this.updateFocus(chart, d, state, d.sprints, x, y, {
            stacks: () => true,
            range: () => x,
            mouseIndex: x => {
                const i = _.sortedIndex(dates, x);
                return Math.min(x - dates[i-1] < dates[i] - x ? i - 1 : i,
                    dates.length - 1
                );
            },
            select: (i, j, target) => {
                const stack = _.find(stackValues,
                    f => target[1] <= y(f[i][0]) && target[1] >= y(f[i][1])
                );
                if (!stack) {
                    return undefined;
                }
                return {
                    i, index: i,
                    scale: y,
                    feature: stack[i][1]
                };
            },
            highlight: (d, index, feature) => _.some(stacks,
                (stack, key) => stack[index][1] === feature &&
                    (key.startsWith(`${d[0]}-`) || key.endsWith(`-${d[0]}`))
            ),
            focus: (focusHolder, i, pos, feature) =>
                this.updateLineFocus(focusHolder, i, pos, feature, {
                    sprints: d.sprints,
                    dates: dates,
                    x: x
                })
        });

        this.updateAxes(chart, state, d, x, y, {
            x: {
                axis: d3.axisBottom(x),
                label: {
                    text: this.locales.attribute("sprint_meta", "start_date")
                }
            },
            y0: true
        });

        const line = d3.line()
            .defined(this.defined)
            .x((g, i) => x(dates[i]))
            .y(g => y(g[1]))
            .curve(d3.curveMonotoneX);

        const area = d3.area()
            .curve(d3.curveMonotoneX)
            .x((g, i) => x(dates[i]))
            .y0(g => y(g[0]))
            .y1(g => y(g[1]));

        chart.select("g.features.areas").selectAll("g.feature")
            .each((f, j, features) => {
                this.updateFeatureArea(dates,
                    stacks[`${f.visible_key}-${f.feature_key}`], f, j,
                    d3.select(features[j]), {
                        x: x,
                        y: y,
                        area: area
                    }, t
                );
            });
        chart.select("g.features.lines").selectAll("g.feature")
            .each((f, j, features) => {
                this.updateFeatureLine(dates,
                    stacks[`${f.visible_key}-${f.feature_key}`], f, j,
                    d3.select(features[j]), {
                        line: line,
                        x: x,
                        y: y
                    }, t
                );
            });
    }

    updateFeatureArea(dates, stack, f, j, feature, config, t) {
        feature.select(".area")
            .attr("fill", this.scheme[j % this.scheme.length])
            .attr("d", typeof stack === "undefined" ? null : config.area(stack))
            .attr("fill-opacity", 0)
            .transition(t)
            .attr("fill-opacity", 1);
    }

    updateFeatureLine(dates, stack, f, j, feature, config, t) {
        feature.select(".line")
            .attr("stroke", this.scheme[j % this.scheme.length])
            .attr("d", typeof stack === "undefined" ? null : config.line(stack))
            .transition(t)
            .attrTween("stroke-dasharray", function() {
                const length = this.getTotalLength();
                return d3.interpolateString(`0,${length}`, `${length},${length}`);
            });

        const points = feature.selectAll("circle")
            .data(typeof stack === "undefined" ? [] : stack);

        points.exit().remove();
        const point = points.enter()
            .append("circle")
            .attr("r", 4)
            .attr("stroke", "#ffffff")
            .attr("stroke-width", "0.1rem");

        points.merge(point)
            .attr("fill", this.scheme[j % this.scheme.length])
            .classed("is-hidden", g => !this.defined(g[1]))
            .attr("cx", (g, i) => config.x(dates[i]))
            .attr("cy", g => config.y(g[1]))
            .attr("fill-opacity", 0)
            .transition(t)
            .attr("fill-opacity", 1);
    }
}
