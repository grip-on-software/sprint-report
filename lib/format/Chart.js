import _ from 'lodash';
import * as d3 from 'd3';
import {OrderedSet} from 'immutable';
import {filterSprints, sprintsToFeatures, getSprintMeta} from '../data';
import Format from './Format';
import Axis from './chart/Axis';
import Focus from './chart/Focus';

const linspace = function(start, stop, nsteps) {
    const delta = nsteps === 1 ? 0 : (stop - start) / (nsteps - 1);
    return d3.range(nsteps).map(i => start + i * delta);
};

export default class Chart extends Format {
    initialize() {
        this.margin = {top: 20, right: 20, bottom: 30, left: 20, yAxis: 50};
        this.legendPadding = {top: 5, left: 5, right: 5, bottom: 5};
        this.scheme = d3.schemeCategory10;

        this.legendConfig = null;
        this.legendWidths = [];
        this.legendHeights = [];
        this.resize();
    }

    resize() {
        this.svgWidth = Math.max(960, this.content.node().clientWidth - 64);
        this.svgHeight = Math.round(this.svgWidth / 2.5);
        this.width = this.svgWidth - this.margin.left - this.margin.right -
            this.margin.yAxis;
        this.height = this.svgHeight - this.margin.top - this.margin.bottom;
        this.textHeight = 20;
    }

    cleanup() {
        super.cleanup();
        d3.select(window).on("resize", null);
    }

    createCharts(data, state, axes={}) {
        const projects = this.content.selectAll('svg.chart')
            .data(data, d => d.project_name);
        projects.exit().remove();
        var { newCharts, newProjects, newLegends } =
            this.buildChartDimensions(projects, axes);
        newLegends.append("g")
            .classed("header", true)
            .attr("transform", `translate(${-this.legendPadding.right},${this.legendPadding.top})`)
            .append("text")
            .classed("label", true)
            .style("text-anchor", "end")
            .text(d => d.display_name || d.project_name);

        this.addResizeHandler(state, axes);

        return {projects, newProjects, newCharts};
    }

    addResizeHandler(state, axes) {
        d3.select(window).on("resize", () => requestAnimationFrame(() => {
            this.resize();
            this.content.classed("is-resizing", true);
            const t = d3.transition().duration(500).on("end", () => {
                this.content.classed("is-resizing", false);
            });
            const charts = this.content.selectAll('svg.chart');
            this.buildChartDimensions(charts, axes, t);
            charts.each((d, i, nodes) => this.updateChart(state,
                d3.select(nodes[i]), d, i, t
            ));
        }));
    }

    buildChartDimensions(content, axes={}, t=null) {
        const width = axes.y2 ? this.width - this.margin.yAxis : this.width;
        var newCharts = content.enter().append('svg')
            .classed('chart', true);
        newCharts.merge(content)
            .transition(t)
            .attr('width', this.svgWidth + this.textHeight)
            .attr('height', this.svgHeight + this.textHeight);

        var newProjects = newCharts.append("g")
            .attr("transform", `translate(${this.margin.left + this.margin.yAxis}, ${this.margin.top})`);

        // Create the axes
        // No need to perform updates on axes - updateChart is meant to do that
        // and avoid performing transformations with unadjusted widths.

        newProjects.append("g")
            .classed("axis x", true)
            .attr("transform", `translate(0, ${this.height})`);

        newProjects.append("text")
            .classed("label x", true)
            .attr("x", width / 2)
            .attr("y", this.height + this.margin.top + this.textHeight)
            .style("text-anchor", "middle");

        newProjects.append("g")
            .classed("axis y", true);

        newProjects.append("text")
            .classed("label y", true)
            .attr("transform", "rotate(-90)")
            .attr("y", -this.margin.left - this.margin.yAxis + this.textHeight)
            .attr("x", -this.height / 2)
            .style("text-anchor", "middle");

        // Additional axes
        if (axes.x2) {
            newProjects.append("g")
                .classed("axis x2", true);
        }

        if (axes.y2) {
            newProjects.append("g")
                .classed("axis y2", true)
                .attr("transform", `translate(${width}, 0)`);
            newProjects.append("text")
                .classed("label y2", true)
                .attr("transform", "rotate(-90)")
                .attr("y", width + this.margin.right + this.margin.yAxis)
                .attr("x", -this.height / 2)
                .style("text-anchor", "middle");
        }

        if (axes.y0) {
            newProjects.append("g")
                .classed("axis y0", true)
                .attr("transform", `translate(0, ${this.height})`)
                .append("line")
                .attr("stroke", "#000");
        }
        if (axes.x0) {
            newProjects.append("g")
                .classed("axis x0", true)
                .append("line")
                .attr("stroke", "#000");
        }

        if (axes.yx) {
            newProjects.append("g")
                .classed("axis yx", true)
                .append("line")
                .attr("stroke", "#000");
        }

        // Create the legend
        const newLegendHolder = newProjects.append("g")
            .classed("legend", true)
            .attr('transform', `translate(${this.width},${this.margin.top})`);
        content.selectAll("g.legend").transition(t)
            .attr('transform', `translate(${this.width},${this.margin.top})`);
        newLegendHolder.append("rect")
            .classed("box", true)
            .attr("stroke", "#000000")
            .attr("fill", "#000000")
            .attr("fill-opacity", 0.1);
        const newLegends = newLegendHolder.append("g")
            .classed("lines", true);

        return { newCharts, newProjects, newLegends };
    }

    createFocus(newProjects) {
        const focus = newProjects.append("g")
            .classed("focus", true)
            .style("visibility", "hidden");

        const tooltip = focus.append("g")
            .classed("details", true);

        tooltip.append("rect")
            .attr("fill", "#000000")
            .attr("fill-opacity", 0.8)
            .attr("width", 150);

        tooltip.append("g")
            .classed("options", true);

        tooltip.append("text")
            .attr("dy", ".31em");

        const overlay = newProjects.append("g")
            .attr("pointer-events", "all")
            .append("rect")
            .classed("overlay", true)
            .attr("pointer-events", "all")
            .attr("fill", "none")
            .attr("x", 0)
            .attr("y", 0)
            .attr("width", this.width)
            .attr("height", this.height);

        return { focus, overlay };
    }

    createStacks(state, select) {
        return _.reduce(select, (accumulator, feature) => {
            accumulator.push(feature);
            const assignment = state.features.expressions[feature];
            if (assignment && _.includes(assignment.expression, '+') &&
                !_.includes(assignment.expression, '(')) {
                accumulator = _.concat(accumulator,
                    _.map(assignment.attributes,
                        attribute => [attribute, accumulator.length - 1]
                    )
                );
            }
            return accumulator;
        }, []);
    }

    createFeatures(state, updateProjects, config={}) {
        var select = Array.from(state.features.selected);
        if (config.stacks) {
            select = this.createStacks(state, select);
        }

        const features = updateProjects.select("g.features")
            .selectAll("g.feature")
            .data(
                d => sprintsToFeatures(filterSprints(state, d.sprints),
                    select, state.features.visible, config
                ),
                d => `${d.visible_key}-${d.feature_key}`
            );

        features.exit().remove();

        const newFeatures = features.enter().append("g")
            .classed("feature", true);

        newFeatures.merge(features).order()
            .style("visibility", d =>
                state.features.visible.has(d.visible_key) ? null : "hidden"
            );

        return { newFeatures, select };
    }

    updateLegends(state, updateProjects, config) {
        config = _.assign({}, {
            data: state.features,
            hideLines: data => data.selected.size <= 1,
            text: d => this.locales.retrieve(this.localization.descriptions, d),
            header: true,
            sample: legend => legend.append("rect")
                .attr("x", -18)
                .attr("y", -8)
                .attr("width", 18)
                .attr("height", 4),
            color: sample => sample.style("fill",
                (d, i) => this.scheme[i % this.scheme.length]
            ),
            sampleWidth: 18,
            t: d3.transition().duration(500)
        }, config);
        this.legendConfig = config;
        const hideLines = config.hideLines(config.data);
        const legendHolders = updateProjects.select("g.legend");
        const legends = legendHolders.select("g.lines").selectAll("g.line")
            .data(hideLines ? [] : Array.from(config.data.selected));
        const padding = this.legendPadding;

        legends.exit().remove();
        const legend = legends.enter()
            .append("g")
            .classed("line", true)
            .attr("transform", (d, i) => `translate(${-padding.right},${padding.top + (i + config.header) * this.textHeight})`);
        legend.attr("fill-opacity", 0)
            .transition()
            .duration(1000)
            .attr("fill-opacity",
                d => config.data.visible.includes(d) ? 1 : 0.33
            );
        legends.attr("fill-opacity",
            d => config.data.visible.includes(d) ? 1 : 0.33
        );

        config.sample(legend).classed("sample", true);

        legend.append("text")
            .attr("x", -config.sampleWidth - 2)
            .style("text-anchor", "end");

        const updateLegends = legends.merge(legend).order();
        config.color(updateLegends.select(".sample"));
        updateLegends.select("text")
            .text(d => config.text(d));

        this.legendWidths = [];
        this.legendHeights = [];
        legendHolders.each((d, i, nodes) => {
            const legendHolder = d3.select(nodes[i]);
            const boundingBox = legendHolder.select("g.lines").node().getBBox();
            const width = boundingBox.width + padding.left + padding.right;
            const height = hideLines ?
                config.header * (this.textHeight + padding.top + padding.bottom) :
                (config.data.selected.size + config.header) * this.textHeight +
                padding.top + padding.bottom;
            legendHolder.select("rect.box")
                .transition(config.t)
                .attr("x", boundingBox.x - padding.left)
                .attr("y", boundingBox.y - padding.top)
                .attr("width", width)
                .attr("height", height);
            this.legendWidths.push(width);
            this.legendHeights.push(height);
        });
    }

    updateFocus(chart, data, state, sprints, x, y, callbacks) {
        callbacks = _.assign({}, {
            bbox: () => ({
                width: x.range()[x.range().length - 1],
                height: this.height
            }),
            stacks: () => false,
            range: () => d3.scaleLinear()
                .range(linspace(0, x.range()[x.range().length - 1], sprints.length))
                .domain(_.range(sprints.length)),
            mouseIndex: x => Math.round(x),
            select: (i, j, target) => undefined,
            focus: (focusHolder, i, pos) => {},
            filter: (features) => features,
            highlight: (d, i, feature) => d[1] === feature ||
                (this.defined(d[1]) && d[1].max === feature),
            format: (key, value, node, index, adjust) => {
                if (state.sprint_meta.selected.includes(key)) {
                    return this.formatSprint([key, value], node,
                        state.sprint_meta
                    );
                }
                if (state.features.selected.includes(key)) {
                    const description = node.append('tspan')
                        .text(`${this.locales.retrieve(this.localization.descriptions, key)}: `);
                    adjust.left += description.node().getComputedTextLength();
                    this.formatFeature(key, value, node.append('tspan'),
                        chart, adjust
                    );
                    if (callbacks.stacks(key)) {
                        const assignment = state.features.format.assignment(
                            key, ["short_units", "units"], sprints[index]
                        );
                        if (assignment !== null &&
                            _.includes(assignment, '+') &&
                            !_.includes(assignment, "(")) {
                            node.append('tspan').text(` (${assignment})`);
                        }
                    }
                    return null;
                }
                return value;
            },
            has_source: (d, i) => {
                return !_.isArray(d[1]) &&
                    (i === 0 || state.features.selected.includes(d[0]));
            },
            source_icon: (source) => source && this.localization.sources &&
                this.localization.sources.icon ?
                this.localization.sources.icon[source] : null,
            add_icon: (container, icon, adjust) => {
                this.addIcon(container, icon, adjust);
            },
            link: (d, i, item, x) => {
                if (state.sprint_meta.selected.includes(d[0])) {
                    if (x >= 0 && _.isArray(d[1])) {
                        const span = item.selectAll("tspan").nodes();
                        const index = _.transform(span, (accumulator, node) => {
                            accumulator.width += node.getComputedTextLength();
                            accumulator.index++;
                            if (x < accumulator.width) {
                                return false;
                            }
                            return null;
                        }, {width: 0, index: -1}).index;
                        if (index !== -1) {
                            return {
                                source: this.getSprintUrl({
                                    sprint_id: sprints[i].sprint_id[index],
                                    board_id: sprints[i].board_id[index]
                                })
                            };
                        }
                    }
                    else {
                        return {
                            source: this.getSprintUrl(sprints[i])
                        };
                    }
                }
                return data.links[d[0]] || {};
            },
            makeLink: (link, i) => this.makeSprintUrl(link, data, sprints[i]),
            options: (d, i) => ({}),
            click: (target) => this.clickLegend(chart, state, target)
        }, callbacks);

        const focus = new Focus(chart, data, state, sprints, y, callbacks);

        chart.selectAll('.overlay')
            .on("mouseover.tooltip", () => focus.show())
            .on("mouseout.tooltip", () => focus.hide())
            .on("mousemove.tooltip", () => {
                focus.moveTooltip(d3.event.currentTarget);
            })
            .on("mouseup.tooltip", () => {
                focus.pinTooltip(d3.event.currentTarget);
            });

        return focus;
    }

    clickLegend(chart, state, target) {
        const legendHolder = chart.select('g.legend');
        if (legendHolder.empty()) {
            return false;
        }
        const bbox = legendHolder.node().getBoundingClientRect();
        const cbox = chart.selectAll('.overlay').node().getBoundingClientRect();
        if (target[0] < bbox.left - cbox.x || target[0] > bbox.right - cbox.x ||
            target[1] < bbox.top - cbox.y || target[1] > bbox.bottom - cbox.y
        ) {
            return false;
        }
        const row = Math.floor(
            (target[1] - (bbox.top - cbox.y) - this.legendPadding.top) /
            this.textHeight - (legendHolder.select("g.header").empty() ? 0 : 1)
        );
        return this.clickLegendRow(state, row);
    }

    clickLegendRow(state, row) {
        if (row >= 0) {
            const charts = this.content.selectAll("svg > g");
            const legendHolder = charts.selectAll("g.legend");
            const config = this.legendConfig;
            if (config === null || config.data.selected.size <= row) {
                return true;
            }
            const content = Array.from(config.data.selected)[row];
            const remove = config.data.visible.includes(content);
            config.data.visible = remove ? config.data.visible.delete(content) :
                config.data.visible.add(content);
            const t = d3.transition().duration(1000);
            legendHolder.selectAll("g.line")
                .filter(d => d === content)
                .transition(t)
                .attr("fill-opacity", remove ? 0.33 : 1);
            this.updateFeatures(state, charts);
            charts.each((d, i, nodes) => {
                const chart = d3.select(nodes[i]);
                this.updateChart(state, chart, d, i, t);
            });
        }
        return true;
    }

    updateAxes(chart, state, d, x, y, config={}) {
        const main_meta = state.sprint_meta.changed ? "main" : "sprint_num";
        const width = x.range()[x.range().length - 1];
        config = _.merge({}, {
            t: d3.transition().duration(500),
            x: {
                label: {
                    text: this.locales.attribute("sprint_meta",
                        getSprintMeta(state.sprint_meta, main_meta)
                    ),
                    x: width / 2,
                    y: this.height + this.margin.top + this.textHeight
                },
                transform: `translate(0, ${this.height})`,
                axis: d3.axisBottom(x)
                    .tickValues(x.domain())
                    .tickFormat((i, j, nodes) => this.formatSprint(d.sprints[i],
                        nodes[j], state.sprint_meta, main_meta, true
                    )),
            },
            y: {
                label: {
                    features: state.features.selected,
                    text: this.locales.message("features-header"),
                    x: -this.height / 2,
                    y: -this.margin.left - this.margin.yAxis + this.textHeight
                },
                transform: null,
                axis: d3.axisLeft(y)
            },
            x2: {
                label: {},
                transform: null,
                axis: null
            },
            y2: {
                label: {
                    x: -this.height / 2,
                    y: width + this.margin.right + this.margin.yAxis
                },
                transform: `translate(${width},0)`,
                axis: null
            },
            y0: null,
            x0: null,
            yx: null
        }, config);

        _.forEach(['x', 'y', 'x2', 'y2'], name => {
            if (config[name] !== null) {
                const axis = new Axis(chart, name, config[name]);
                axis.update(config.t, this.locales, this.localization);
            }
        });

        if (config.x0 !== null) {
            const xZero = x(0);
            chart.select('.axis.x0')
                .transition(config.t)
                .attr("opacity", xZero < x.range()[0] || xZero > width ? 0 : 1)
                .attr("transform", `translate(${xZero},0)`)
                .select("line")
                .attr("y2", this.height);
        }
        if (config.y0 !== null) {
            const yZero = y(0);
            chart.select('.axis.y0')
                .transition(config.t)
                .attr("opacity", yZero < 0 || yZero > this.height ? 0 : 1)
                .attr("transform", `translate(0,${yZero})`)
                .select("line")
                .attr("x2", width);
        }
        if (config.yx !== null) {
            chart.select('.axis.yx')
                .transition(config.t)
                .select("line")
                .attr("x1", Math.max(0, x(y.domain()[0])))
                .attr("x2", Math.min(width, x(y.invert(0))))
                .attr("y1", Math.min(this.height, y(x.domain()[0])))
                .attr("y2", Math.max(0, y(x.invert(width))));
        }
    }

    splitMagnitudes(state, data) {
        const sprintData = _.map(data, "sprints");
        const magnitude = x => Math.max(Math.floor(Math.log10(Math.abs(x))), 0);
        const extents = _.map(sprintData, s => d3.extent(s));
        const magnitudes = _.map(extents, e => magnitude(e[0]));
        const middleMagnitude = _.isEmpty(magnitudes) ? 0 :
            _.max(magnitudes) - _.min(magnitudes);

        const features = Array.from(state.features.visible);
        const lowFeatures = OrderedSet(middleMagnitude < 2 ? features :
            _.filter(features, (f, i) => magnitudes[i] < middleMagnitude)
        );
        const highFeatures = OrderedSet(middleMagnitude < 2 ? [] :
            _.filter(features, (f, i) => magnitudes[i] >= middleMagnitude)
        );
        const lowData = middleMagnitude < 2 ? sprintData :
            _.filter(extents, (d, i) => magnitudes[i] < middleMagnitude);
        const highData = middleMagnitude < 2 ? [] :
            _.filter(extents, (d, i) => magnitudes[i] >= middleMagnitude);

        return {lowFeatures, highFeatures, lowData, highData, middleMagnitude};
    }

    updateFeatures(state, charts) {
        return this.createFeatures(state, charts);
    }

    updateChart(state, chart, d, i, t) {
    }
}

export {Chart, linspace};
