import _ from 'lodash';
import * as d3 from 'd3';
import {filterSprints, sprintsToFeatures, getSprintMeta} from '../data';
import Format from './Format';

const linspace = function(start, stop, nsteps) {
    const delta = (stop - start) / (nsteps - 1);
    return d3.range(nsteps).map(i => start + i * delta);
};

export default class Chart extends Format {
    initialize() {
        this.margin = {top: 20, right: 20, bottom: 30, left: 70};
        this.legendPadding = {top: 5, left: 5, right: 5, bottom: 5};
        this.tooltipPadding = {top: 5, left: 15, right: 15, bottom: 10};
        this.svgWidth = 1280;
        this.svgHeight = 512;
        this.width = this.svgWidth - this.margin.left - this.margin.right;
        this.height = this.svgHeight - this.margin.top - this.margin.bottom;
        this.textHeight = 20;
        this.scheme = d3.schemeCategory10;

        this.legendConfig = null;
        this.legendWidths = [];
        this.legendHeights = [];
    }

    createCharts(data) {
        const projects = this.content.selectAll('svg')
            .data(data, d => d.project_name);
        projects.exit().remove();
        var { newCharts, newProjects, newLegends } =
            this.buildChartDimensions(projects.enter());
        newLegends.append("g")
            .classed("header", true)
            .attr("transform", `translate(${-this.legendPadding.right},${this.legendPadding.top})`)
            .append("text")
            .classed("label", true)
            .style("text-anchor", "end")
            .text(d => d.display_name || d.project_name);

        return {projects, newProjects, newCharts};
    }

    buildChartDimensions(content, axes={}) {
        var newCharts = content.append('svg')
            .classed('chart', true)
            .attr('width', this.svgWidth + this.textHeight)
            .attr('height', this.svgHeight + this.textHeight);
        var newProjects = newCharts.append("g")
            .attr("transform", `translate(${this.margin.left}, ${this.margin.top})`);

        newProjects.append("g")
            .classed("axis x", true)
            .attr("transform", `translate(0, ${this.height})`);

        newProjects.append("text")
            .classed("label x", true)
            .attr("transform", `translate(${this.width / 2}, ${this.height + this.margin.top + this.textHeight})`)
            .style("text-anchor", "middle");

        newProjects.append("g")
            .classed("axis y", true);

        newProjects.append("text")
            .classed("label y", true)
            .attr("transform", "rotate(-90)")
            .attr("y", -this.margin.left + this.textHeight)
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
                .attr("transform", `translate(${this.width}, 0)`);
        }

        if (axes.y0) {
            newProjects.append("g")
                .classed("axis y0", true)
                .attr("transform", `translate(0, ${this.height})`)
                .append("line")
                .attr("stroke", "#000");
        }

        const newLegendHolder = newProjects.append("g")
            .classed("legend", true)
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
            .attr("x", this.tooltipPadding.left)
            .attr("y", this.tooltipPadding.top)
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

    createFeatures(state, updateProjects) {
        const features = updateProjects.select("g.features")
            .selectAll("g.feature")
            .data(
                d => sprintsToFeatures(filterSprints(state, d.sprints),
                    state.features.selected, state.features.visible
                ),
                d => d.feature_key
            );

        features.exit().remove();

        const newFeatures = features.enter().append("g")
            .classed("feature", true);

        newFeatures.merge(features)
            .style("visibility",
                d => state.features.visible.has(d.feature_key) ? null : "hidden"
            );

        return newFeatures;
    }

    updateLegends(state, updateProjects, config) {
        config = _.assign({}, {
            data: state.features,
            text: d => this.locales.retrieve(this.localization.descriptions, d),
            header: true,
            sample: legend => legend.append("rect")
                .attr("x", -18)
                .attr("y", -8)
                .attr("width", 18)
                .attr("height", 4),
            sampleWidth: 18
        }, config);
        this.legendConfig = config;
        const legendHolders = updateProjects.select("g.legend");
        const legends = legendHolders.select("g.lines").selectAll("g.line")
            .data(config.data.selected.size <= 1 ? [] :
                Array.from(config.data.selected)
            );
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
        updateLegends.select(".sample")
            .style("fill", (d, i) => this.scheme[i % this.scheme.length]);
        updateLegends.select("text")
            .text(d => config.text(d));

        this.legendWidths = [];
        this.legendHeights = [];
        legendHolders.each((d, i, nodes) => {
            const legendHolder = d3.select(nodes[i]);
            const boundingBox = legendHolder.select("g.lines").node().getBBox();
            const width = boundingBox.width + padding.left + padding.right;
            const height = config.data.selected.size <= 1 ?
                config.header * (this.textHeight + padding.top + padding.bottom) :
                (config.data.selected.size + config.header) * this.textHeight +
                padding.top + padding.bottom;
            legendHolder.select("rect.box")
                .transition()
                .duration(500)
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
            range: () => d3.scaleLinear()
                .range(linspace(0, x.range()[x.range().length - 1], sprints.length))
                .domain(_.range(sprints.length)),
            mouseIndex: x => Math.round(x),
            select: (i, j, target) => undefined,
            focus: (focusHolder, i, pos) => {},
            filter: (features) => features,
            highlight: (d, i, feature) => d[1] === feature,
            format: (key, value, node) => value,
            has_source: (d, i) => {
                return i === 0 || state.features.selected.includes(d[0]);
            },
            link: (d, i) => {
                if (state.sprint_meta.selected.includes(d[0])) {
                    return {
                        source: this.getSprintUrl(sprints[i])
                    };
                }
                return data.links[d[0]] || {};
            },
            options: (d, i) => ({})
        }, callbacks);
        const focusHolder = chart.select('.focus');
        const offset = {
            height: 16,
            icon: 20,
            option: 8
        };

        var x1 = callbacks.range();

        const selectFeature = (eventTarget) => {
            const target = d3.mouse(eventTarget);
            const j = y.invert(target[1]);
            var i = callbacks.mouseIndex(x1.invert(target[0]));
            var index = i;
            var feature = callbacks.select(i, j, target);
            if (_.isObject(feature)) {
                ({ feature, i, index } = feature);
            }
            return {target, i, j, feature, index};
        };

        const addIcon = (container, icon, adjust) => {
            adjust = _.assign({}, {
                iconWidth: 512,
                scale: 0.025,
                width: 16.25,
                top: 0,
                left: 0
            }, adjust);
            const packs = {fab: "brands", fas: "solid"};
            /* jshint ignore:start */
            import(
                `@fortawesome/free-${packs[icon[0]]}-svg-icons/${_.camelCase(icon[1])}.js`
            ).then(fa => {
                container.append("path")
                    .classed("icon", true)
                    .attr("d", fa.svgPathData)
                    .attr("transform", `translate(${adjust.left + (adjust.iconWidth - fa.width) * 0.5 * adjust.scale}, ${adjust.top}) scale(${adjust.scale})`);
            });
            /* jshint ignore:end */
        };

        const showTooltip = (index, i, feature) => {
            const pos = typeof feature === "undefined" ? 0 : y(feature);
            callbacks.focus(focusHolder, i, pos);

            const tooltip = focusHolder.selectAll('.details');
            const missing = typeof sprints[index] === "undefined";
            tooltip.style("visibility", missing ? "hidden" : null);
            if (missing) {
                return null;
            }

            const text = tooltip.select("text");
            tooltip.selectAll("path.icon").remove();
            const metadata = _.toPairs(_.pick(sprints[index], callbacks.filter(
                _.concat(Array.from(state.sprint_meta.selected),
                    Array.from(state.features.selected)
                )
            )));
            const meta = text.selectAll("tspan.meta").data(metadata);
            meta.exit().remove();
            meta.enter().append("tspan")
                .classed("meta", true)
                .attr('dy', offset.height)
                .style('font-size', '0.8em')
                .merge(meta).order()
                .attr('x', this.tooltipPadding.left)
                .classed("has-icon", false)
                .classed("has-source", (d, i) => callbacks.has_source(d, i))
                .classed("highlight",
                    d => callbacks.highlight(d, index, feature)
                )
                .text((d, j, nodes) => {
                    if (state.sprint_meta.selected.includes(d[0])) {
                        return this.formatSprint(d, nodes[j],
                            state.sprint_meta
                        );
                    }
                    if (state.features.selected.includes(d[0])) {
                        return this.locales.message("feature-tooltip", [
                            this.locales.retrieve(this.localization.descriptions, d[0]),
                            this.formatFeature(d[0], d[1])
                        ]);
                    }
                    return callbacks.format(d[0], d[1], nodes[j]);
                })
                .each((d, j, nodes) => {
                    const source = callbacks.link(d, index).type;
                    if (source && this.localization.sources &&
                        this.localization.sources.icon &&
                        this.localization.sources.icon[source]
                    ) {
                        const icon = this.localization.sources.icon[source];
                        addIcon(tooltip, icon, {
                            scale: 0.025,
                            top: this.tooltipPadding.top + offset.height * j + 4,
                            left: this.tooltipPadding.left
                        });
                        d3.select(nodes[j]).classed("has-icon", true)
                            .attr('x', this.tooltipPadding.left + offset.icon);
                    }
                });
            const options = tooltip.select("g.options")
                .selectAll("g.option")
                .data(callbacks.options(tooltip, index));
            options.exit().merge(options)
                .each((d, i, nodes) => {
                    text.select(`#option-${d.id}`).remove();
                    d3.select(nodes[i]).selectAll("*").remove();
                });
            options.exit().remove();
            const newOptions = options.enter().append("g")
                .classed("option", true)
                .merge(options).order()
                .each((d, i, nodes) => {
                    const width = d.icon ? offset.icon : offset.option;
                    const padding = d.text ? offset.option : 0;
                    const optionText = text.append("tspan")
                        .classed("option", true)
                        .classed("has-source", !!d.click)
                        .classed("has-icon", !!d.icon)
                        .datum(d.id)
                        .attr("id", `option-${d.id}`)
                        .attr('x', i === 0 ? this.tooltipPadding.left + width : null)
                        .attr('dx', i === 0 ? null : `${padding * -3 + 24}px`)
                        .attr('dy', i === 0 ? '1.6em' : null)
                        .attr('style', 'font-size: 1.2em')
                        .text(`\u00A0${d.text || ""}`);
                    const node = optionText.node();
                    var size;
                    try {
                        const bbox = node.getBBox();
                        const textWidth = node.getComputedTextLength();
                        size = {
                            left: bbox.x + _.sumBy(nodes, n => {
                                const r = d3.select(n).select("rect");
                                if (r.empty()) {
                                    return 0;
                                }
                                return Number(r.attr("width"));
                            }),
                            top: bbox.y + metadata.length * offset.height,
                            width: textWidth + width,
                            height: 27
                        };
                    }
                    catch (ex) {
                        const nbox = node.getBoundingClientRect();
                        const cbox = tooltip.node().getBoundingClientRect();
                        size = {
                            left: nbox.left - width - cbox.x,
                            top: nbox.top - cbox.y,
                            width: nbox.width + width + padding,
                            height: nbox.height
                        };
                    }
                    const option = d3.select(nodes[i]);
                    option.attr("transform", `translate(${size.left}, ${size.top})`);
                    option.append("rect")
                        .attr("width", size.width)
                        .attr("height", size.height)
                        .attr("rx", 5)
                        .attr("ry", 5);
                    if (typeof d.icon !== "undefined") {
                        addIcon(option, d.icon, {
                            scale: 0.025,
                            width: 16,
                            left: 8,
                            top: (size.height - 12) / 2
                        });
                    }
                });
            const bbox = text.node().getBBox();
            tooltip.select("rect")
                .attr("width", bbox.width +
                    this.tooltipPadding.left + this.tooltipPadding.right
                )
                .attr("height", bbox.height +
                    this.tooltipPadding.top + this.tooltipPadding.bottom
                );
            return bbox;
        };

        const updateFocusPosition = (target, index, datum, bbox) => {
            if (bbox === null) {
                focusHolder.classed("fixed", false).datum([]);
                return;
            }
            const width = bbox.width + this.tooltipPadding.left +
                this.tooltipPadding.right;
            const height = bbox.height + this.tooltipPadding.top +
                this.tooltipPadding.bottom;
            const x = target[0] + width > this.width ? target[0] - width :
                target[0];
            const y = target[1] + height > this.height ? target[1] - height :
                target[1];
            focusHolder.classed("fixed", _.isEqual(datum, [0]))
                .datum(datum)
                .selectAll(".details")
                .attr("transform", `translate(${x}, ${y})`)
                .datum({pos: [x, y], index: index});
        };

        const moveTooltip = (eventTarget) => {
            const datum = focusHolder.datum();
            if (_.isEqual(datum, [0])) {
                return false;
            }
            const { target, i, feature, index } = selectFeature(eventTarget);

            if (_.isEqual(datum, [i, feature])) {
                const bbox = focusHolder.selectAll(".details")
                    .select("text").node().getBBox();
                updateFocusPosition(target, index, [i, feature], bbox);
                return false;
            }
            updateFocusPosition(target, index, [i, feature],
                showTooltip(index, i, feature)
            );
            return true;
        };

        const pinTooltip = (eventTarget) => {
            var { target, i, feature, index } = selectFeature(eventTarget);
            const tooltip = focusHolder.selectAll(".details");
            const rect = tooltip.select("rect");
            const { pos, index: current } = tooltip.datum();
            if (this.clickLegend(chart, state, target)) {
                focusHolder.datum(null);
                return true;
            }

            const datum = focusHolder.datum();
            if (_.isEqual(datum, [])) {
                return false;
            }
            const fixed = _.isEqual(datum, [0]);
            if (fixed) {
                if (target[0] >= pos[0] &&
                    target[0] <= pos[0] + Number(rect.attr("width")) &&
                    target[1] >= pos[1] &&
                    target[1] <= pos[1] + Number(rect.attr("height"))) {
                    // Clicking inside of tooltip
                    const meta = tooltip.selectAll("tspan.meta").size();
                    const rects = tooltip.selectAll("g.option rect").nodes();
                    const item = tooltip.selectAll("tspan")
                        .filter((d, j, nodes) => {
                            const m = d3.select(nodes[j]);
                            if (!m.classed("has-source")) {
                                return false;
                            }
                            var rect;
                            try {
                                const bbox = nodes[j].getBBox();
                                const left = j < meta ?
                                    this.tooltipPadding.left :
                                    bbox.x + _.sumBy(_.takeWhile(rects,
                                        (n, i) => i < j - meta
                                    ), n => {
                                        const r = d3.select(n);
                                        return Number(r.attr("width"));
                                    });
                                const top = this.tooltipPadding.top +
                                    Math.min(j, meta) * offset.height;
                                rect = {
                                    left: pos[0] + left,
                                    right: pos[0] + left +
                                        nodes[j].getComputedTextLength() +
                                        (m.classed("has-icon") ? offset.icon : 0),
                                    top: pos[1] + top,
                                    bottom: pos[1] + top + (j < meta ? offset.height : 27)
                                };
                            }
                            catch (ex) {
                                const nbox = nodes[j].getBoundingClientRect();
                                const cbox = chart.selectAll(".overlay")
                                    .node().getBoundingClientRect();
                                rect = {
                                    left: nbox.left - cbox.x -
                                        (m.classed("has-icon") ? offset.icon : 0),
                                    right: nbox.right - cbox.x,
                                    top: nbox.top - cbox.y,
                                    bottom: nbox.bottom - cbox.y
                                };
                            }
                            return target[0] >= rect.left &&
                                target[0] <= rect.right &&
                                target[1] >= rect.top &&
                                target[1] <= rect.bottom;
                        });
                    if (item.empty()) {
                        return false;
                    }
                    if (item.classed("option")) {
                        const options = callbacks.options(tooltip, current);
                        const option = _.find(options,
                            d => d.id === item.datum()
                        );
                        if (option && option.click) {
                            const result = option.click();
                            if (result === false) {
                                tooltip.style("visibility", "hidden");
                                focusHolder.datum(null);
                                return true;
                            }
                            else if (_.isObject(result)) {
                                ({index, i, feature} = result);
                                updateFocusPosition(pos, index, [0],
                                    showTooltip(index, i, feature)
                                );
                                return true;
                            }
                        }
                    }
                    else if (item.classed("meta")) {
                        const link = callbacks.link(item.datum(), current);
                        if (link) {
                            const source = d3.select(document.body)
                                .append('a')
                                .classed('is-hidden', true)
                                .attr('target', '_blank')
                                .attr('href', link.source);
                            source.node().click();
                            source.remove();
                            return true;
                        }
                    }
                    return false;
                }
            }
            const newIndex = typeof current === "undefined" ? index : current;
            updateFocusPosition(target, newIndex, fixed ? [i, feature] : [0],
                showTooltip(newIndex, i, feature)
            );
            return false;
        };

        chart.selectAll('.overlay')
            .on("mouseover.tooltip", () => focusHolder.style("visibility", null))
            .on("mouseout.tooltip", () => {
                if (!_.isEqual(focusHolder.datum(), [0])) {
                    focusHolder.style("visibility", "hidden");
                }
                focusHolder.datum([]);
            })
            .on("mousemove.tooltip", () => {
                moveTooltip(d3.event.currentTarget);
            })
            .on("mouseup.tooltip", () => {
                pinTooltip(d3.event.currentTarget);
            });

        return { moveTooltip, pinTooltip };
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
            const remove = config.data.visible.has(content);
            config.data.visible = remove ? config.data.visible.delete(content) :
                config.data.visible.add(content);
            const t = d3.transition().duration(1000);
            legendHolder.selectAll("g.line")
                .filter(d => d === content)
                .transition(t)
                .attr("fill-opacity", remove ? 0.33 : 1);
            charts.each((d, i, nodes) => {
                const chart = d3.select(nodes[i]);
                this.createFeatures(state, chart);
                this.updateChart(state, chart, d, i, t);
            });
        }
        return true;
    }

    updateAxes(chart, state, d, x, y, config={}) {
        config = _.assign({}, {
            t: d3.transition().duration(500),
            x: {
                label: this.locales.attribute("sprint_meta",
                    getSprintMeta(state.sprint_meta,
                        state.sprint_meta.changes ? "main" : "sprint_num"
                    )
                ),
                axis: d3.axisBottom(x)
                    .tickValues(x.domain())
                    .tickFormat((i, j, nodes) => this.formatSprint(d.sprints[i],
                        nodes[j], state.sprint_meta,
                        state.sprint_meta.changed ? "main" : "sprint_num", true
                    )),
            },
            y: {
                label: state.features.selected.size === 1 ?
                    this.locales.retrieve(this.localization.descriptions,
                        state.features.selected.first()
                    ) :
                    this.locales.message("features-header"),
                axis: d3.axisLeft(y)
            },
            x2: null,
            y2: null,
            y0: null
        }, config);
        chart.select('.axis.x')
            .transition(config.t)
            .call(config.x.axis);
        chart.select('.axis.y')
            .transition(config.t)
            .call(config.y.axis);
        if (config.x2 !== null) {
            chart.select('.axis.x2')
                .transition(config.t)
                .call(config.x2.axis);
        }

        const width = x.range()[x.range().length - 1];
        if (config.y2 !== null) {
            chart.select('.axis.y2')
                .transition(config.t)
                .attr("transform", `translate(${width},0)`)
                .call(config.y2.axis);
        }

        if (config.y0 !== null) {
            chart.select('.axis.y0')
                .transition(config.t)
                .attr("transform", `translate(0,${y(0)})`)
                .select("line")
                .attr("x2", width);
        }

        chart.select('.label.y')
            .text(config.y.label);
        chart.select('.label.x')
            .text(config.x.label)
            .transition(config.t)
            .attr("transform", `translate(${width / 2},${this.height + this.margin.top + this.textHeight})`);
    }

    updateChart(state, chart, d, i, t) {
    }
}
