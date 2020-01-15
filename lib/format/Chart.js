import _ from 'lodash';
import * as d3 from 'd3';
import {OrderedSet} from 'immutable';
import {sprintsToFeatures, getSprintMeta} from '../data';
import Format from './Format';
import {Axis, axes} from './chart/Axis';
import Focus from './chart/Focus';
import {ANCHOR_ATTR, FILL_OPACITY_ATTR} from '../attrs';

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

        const TRIANGLE_POINTS = '4,-1 -1,8 9,8';
        this.patterns = [
            {
                id: 'point',
                svg: node => node.append('circle')
                    .attr('r', 4)
                    .attr('cx', 4)
                    .attr('cy', 4)
            },
            {
                id: 'triangle_up',
                svg: node => node.append('polygon')
                    .attr('points', TRIANGLE_POINTS)
            },
            {
                id: 'square',
                svg: node => node.append('rect')
                    .attr('width', 8)
                    .attr('height', 8)
            },
            {
                id: 'triangle_down',
                svg: node => node.append('polygon')
                    .attr('points', TRIANGLE_POINTS)
                    .attr('transform', 'rotate(180 4 4)')
            },
            {
                id: 'diamond',
                svg: node => node.append('rect')
                    .attr('width', 8)
                    .attr('height', 8)
                    .attr('transform', 'rotate(45 4 4)')
            },
            {
                id: 'triangle_left',
                svg: node => node.append('polygon')
                    .attr('points', TRIANGLE_POINTS)
                    .attr('transform', 'rotate(270 4 4)')
            },
            {
                id: 'polygon',
                svg: node => node.append('polygon')
                    .attr('points', '4,-1 8,3 7,8 1,8 0,3')
            },
            {
                id: 'triangle_right',
                svg: node => node.append('polygon')
                    .attr('points', TRIANGLE_POINTS)
                    .attr('transform', 'rotate(90 4 4)')
            },
            {
                id: 'plus',
                svg: node => node.append('polygon')
                    .attr('points', '2,-1 6,-1 6,2 9,2 9,6 6,6 6,9 2,9 2,6 -1,6 -1,2 2,2')
            },
        ];
    }

    patternRef(i) {
        return `#${this.patterns[i % this.patterns.length].id}`;
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
        d3.select(window).on("resize.chart", null);
    }

    createCharts(data, state, axes={}) {
        d3.select('#patterns defs')
            .selectAll('[id]')
            .data(_.concat(this.patterns, {id: 'future-fill'}),
                function(d) { return d ? d.id : this.id; }
            )
            .enter()
            .each((d, i, nodes) => {
                if (d.svg) {
                    d.svg(d3.select(nodes[i])).attr('id', d.id);
                }
            });

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
            .style(ANCHOR_ATTR, "end")
            .text(d => d.display_name || d.project_name);

        this.addResizeHandler(state, axes);

        return {projects, newProjects, newCharts};
    }

    addResizeHandler(state, axes) {
        d3.select(window).on("resize.chart", () => requestAnimationFrame(() => {
            this.resize();
            this.content.classed("is-resizing", true);
            const t = d3.transition("chart-resize").duration(500)
                .on("end", () => {
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
            .style(ANCHOR_ATTR, "middle");

        newProjects.append("g")
            .classed("axis y", true);

        newProjects.append("text")
            .classed("label y", true)
            .attr("transform", "rotate(-90)")
            .attr("y", -this.margin.left - this.margin.yAxis + this.textHeight)
            .attr("x", -this.height / 2)
            .style(ANCHOR_ATTR, "middle");

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
                .style(ANCHOR_ATTR, "middle");
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

        if (axes.future) {
            newProjects.append("g")
                .classed("axis future", true)
                .append("rect")
                .attr("fill", "url(#future-fill)");
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
            .attr(FILL_OPACITY_ATTR, 0.1);
        const newLegends = newLegendHolder.append("g")
            .classed("lines", true);

        return { newCharts, newProjects, newLegends };
    }

    makeTransition(data, resolve, duration=1000) {
        return d3.transition("chart-main").duration(duration)
            .on("interrupt end", () => resolve(data));
    }

    createFocus(newProjects) {
        const focus = newProjects.append("g")
            .classed("focus", true)
            .style("visibility", "hidden");

        const tooltip = focus.append("g")
            .classed("details", true);

        tooltip.append("rect")
            .attr("fill", "#000000")
            .attr(FILL_OPACITY_ATTR, 0.8)
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

    createLineFocus(newProjects) {
        const { focus } = this.createFocus(newProjects);

        focus.append("circle")
            .attr("r", 6);

        focus.append("line")
            .attr("y1", 5)
            .attr("y2", this.height);
    }

    updateLineFocus(focusHolder, i, pos, feature, config) {
        const missing = typeof config.sprints[i] === "undefined" ||
            typeof feature === "undefined";
        const visibility = missing ? "hidden" : null;
        const datePos = missing ? 0 : config.x(config.dates[i]);
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

        const featureGroups = updateProjects.selectAll("g.features");
        const features = featureGroups
            .data(d => _.fill(Array(featureGroups.size()), d))
            .selectAll("g.feature")
            .data(
                d => sprintsToFeatures(d.sprints, select,
                    state.features.visible, config
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
            extra: [],
            hideLines: data => data.selected.size <= 1,
            text: (d, extra) => this.locales.retrieve(this.localization.descriptions, d),
            header: true,
            sample: legend => legend.append("rect")
                .attr("x", -18)
                .attr("y", -8)
                .attr("width", 18)
                .attr("height", 4),
            sampleExtra: (d, i, legend) => null,
            extraVisible: d => true,
            color: sample => sample.style("fill",
                (d, i) => this.scheme[i % this.scheme.length]
            ),
            sampleWidth: 18,
            t: d3.transition("chart-legend").duration(500)
        }, config);
        this.legendConfig = config;
        const hideLines = config.hideLines(config.data);
        const legendHolders = updateProjects.select("g.legend");
        const lines = legendHolders.select("g.lines");
        const legends = lines.selectAll("g.line")
            .data(hideLines ? [] : Array.from(config.data.selected));
        const padding = this.legendPadding;

        legends.exit().remove();
        const legend = legends.enter()
            .append("g")
            .classed("line", true)
            .attr("transform", (d, i) => `translate(${-padding.right},${padding.top + (i + config.header) * this.textHeight})`);
        legend.attr(FILL_OPACITY_ATTR, 0)
            .transition()
            .duration(1000)
            .attr(FILL_OPACITY_ATTR,
                d => config.data.visible.includes(d) ? 1 : 0.33
            );
        legends.attr(FILL_OPACITY_ATTR,
            d => config.data.visible.includes(d) ? 1 : 0.33
        );

        config.sample(legend).classed("sample", true);

        legend.append("text")
            .attr("x", -config.sampleWidth - 2)
            .style(ANCHOR_ATTR, "end");

        const updateLegends = legends.merge(legend).order();
        config.color(updateLegends.select(".sample"));
        updateLegends.select("text")
            .text(d => config.text(d, false));

        const extra = lines.selectAll("g.extra")
            .data(config.extra);
        extra.exit().remove();
        const extraLine = extra.enter().append("g")
            .classed("extra", true)
            .each((d, i, nodes) => config.sampleExtra(d, i,
                d3.select(nodes[i])
            ));
        extraLine.append("text")
            .attr("x", -config.sampleWidth - 2)
            .style(ANCHOR_ATTR, "end")
            .text(d => config.text(d, true));

        extraLine.attr(FILL_OPACITY_ATTR, 0)
            .merge(extra).order()
            .attr("transform", (d, i) => `translate(${-padding.right},${padding.top + (config.data.selected.size + i + config.header) * this.textHeight})`)
            .transition()
            .duration(1000)
            .attr(FILL_OPACITY_ATTR, d => config.extraVisible(d) ? 1 : 0.33);

        this.legendWidths = [];
        this.legendHeights = [];
        legendHolders.each((d, i, nodes) => {
            const legendHolder = d3.select(nodes[i]);
            const boundingBox = legendHolder.select("g.lines").node().getBBox();
            const width = boundingBox.width + padding.left + padding.right;
            const height = boundingBox.height + padding.top + padding.bottom;
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

    updateStackedLegends(state, updateProjects, select, t) {
        this.updateLegends(state, updateProjects, {
            t: t,
            sample: legend => legend.append("g"),
            hideLines: data => data.selected.size <= 1 &&
                !_.some(select, s => _.isArray(s)),
            color: sample => {
                const samples = sample.selectAll("g")
                    .data((d, i) => {
                        const selectIndex = _.findIndex(select, s => s === d);
                        var idx = selectIndex + 1;
                        const stacks = [];
                        while (idx < select.length && _.isArray(select[idx])) {
                            stacks.push(select[idx][0]);
                            idx++;
                        }
                        return _.concat([{
                                feature: d,
                                index: selectIndex,
                                min: 0,
                                max: 1
                            }],
                            _.map(stacks, (s, j) => ({
                                feature: s,
                                index: selectIndex + j + 1,
                                min: j / stacks.length,
                                max: (j + 1) / stacks.length
                            }))
                        );
                    });
                samples.exit().remove();
                samples.enter()
                    .append("rect")
                    .attr("x", -16)
                    .attr("y", d => -d.max * 18)
                    .attr("width", 14)
                    .attr("height", d => (d.max - d.min) * 18)
                    .merge(samples).order()
                    .style("fill",
                        (d, i) => this.scheme[d.index % this.scheme.length]
                    );
            }
        });
    }

    updateFocus(chart, data, state, sprints, callbacks) {
        const x = callbacks.x;
        callbacks = _.assign({}, {
            bbox: () => ({
                width: this.width,
                height: this.height
            }),
            stacks: () => false,
            range: () => d3.scaleLinear()
                .range(linspace(0, x.range()[x.range().length - 1], sprints.length))
                .domain(_.range(sprints.length)),
            mouseIndex: x => Math.round(x),
            select: (i, j, target) => undefined,
            focus: (focusHolder, i, pos, feature) => {},
            filter: (features) => features,
            highlight: (d, i, feature) => d[1] === feature ||
                (this.defined(d[1]) && d[1].max === feature),
            format: (d, node, index, adjust, tooltip) => {
                const [key, value] = d;
                if (state.sprint_meta.selected.includes(key)) {
                    return this.formatSprint(d, node, state.sprint_meta);
                }
                if (state.features.selected.includes(key)) {
                    const description = node.append('tspan')
                        .text(`${this.locales.retrieve(this.localization.descriptions, key)}: `);
                    adjust.left += description.node().getComputedTextLength();
                    this.formatFeature(key, value, node.append('tspan'), {
                        svg: tooltip,
                        adjust: adjust
                    });
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
                return callbacks.format_augment(key, value, node, index);
            },
            augment: (features, index) => features,
            format_augment: (key, value, node, index) => value,
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

        const focus = new Focus(chart, data, state, sprints, callbacks);

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
        this.clickLegendRow(state, row);
        return true;
    }

    clickLegendRow(state, row) {
        if (row >= 0) {
            const charts = this.content.selectAll("svg > g");
            const legendHolder = charts.selectAll("g.legend");
            const {visible, line} = this.updateLegendRow(row, legendHolder);
            if (line === null) {
                return;
            }
            const t = d3.transition("chart-legend-row").duration(1000);
            line.transition(t)
                .attr(FILL_OPACITY_ATTR, visible ? 1 : 0.33);
            this.updateFeatures(state, charts);
            charts.each((d, i, nodes) => {
                const chart = d3.select(nodes[i]);
                this.updateChart(state, chart, d, i, t);
            });
        }
        return;
    }

    updateLegendRow(row, legendHolder) {
        const config = this.legendConfig;
        if (config === null || config.data.selected.size <= row) {
            return {visible: null, line: null};
        }
        const content = Array.from(config.data.selected)[row];
        const remove = config.data.visible.includes(content);
        config.data.visible = remove ? config.data.visible.delete(content) :
            config.data.visible.add(content);
        return {
            visible: !remove,
            line: legendHolder.selectAll("g.line")
                .filter(d => d === content)
        };
    }

    updateAxes(chart, state, d, scales, config={}) {
        const mainMeta = state.sprint_meta.changed ? "main" : "sprint_num";
        const width = scales.x.range()[scales.x.range().length - 1];
        config = _.merge({}, {
            t: d3.transition("chart-axis").duration(500),
            x: {
                label: {
                    text: this.locales.attribute("sprint_meta",
                        getSprintMeta(state.sprint_meta, mainMeta)
                    ),
                    x: width / 2,
                    y: this.height + this.margin.top + this.textHeight
                },
                transform: `translate(0, ${this.height})`,
                axis: d3.axisBottom(scales.x)
                    .tickValues(scales.x.domain())
                    .tickFormat((i, j, nodes) => this.formatSprint(d.sprints[i],
                        d3.select(nodes[j]).classed("meta", true),
                        state.sprint_meta, mainMeta, true
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
                axis: d3.axisLeft(scales.y)
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
            yx: null,
            future: null
        }, config);

        _.forEach(['x', 'y', 'x2', 'y2', 'y0', 'x0', 'yx', 'future'], name => {
            if (config[name] !== null) {
                const axisClass = axes[name] || Axis;
                const axis = new axisClass(chart, name, config[name],
                    width, this.height
                );
                axis.update(config.t, scales.x, scales.y, this.locales,
                    this.localization
                );
            }
        });
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
