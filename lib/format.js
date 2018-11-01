import _ from 'lodash';
import * as d3 from 'd3';
import {Set} from 'immutable';
import {vsprintf} from 'sprintf-js';
import config from 'config.json';
import {makeRequests, filterSprints, sprintsToFeatures, getSprintMeta} from './data';

const linspace = function(start, stop, nsteps) {
    const delta = (stop - start) / (nsteps - 1);
    return d3.range(nsteps).map(i => start + i * delta);
};

class Format {
    constructor(locales, localization) {
        this.locales = locales;
        this.localization = localization;
        this.content = d3.select('#format-content');
        this.formatNumber = d3.formatLocale(this.locales.selectedLocale).format("~r");
        this.details = {
            'key': {
                order: 0,
                sort: v => Number(_.last(v.split('-'))),
                format: (cell, v) => cell.append('a')
                    .attr('href', `${config.jira_url}/browse/${v}`)
                    .text(v)
            },
            'title': {
                order: 1,
                format: (cell, v) => cell.text(v)
            },
            'story_points': {
                order: 2,
                format: (cell, v) => cell.classed('has-text-right', true)
                    .text(this.formatNumber(v))
            }
        };
        this.cleanup();
    }

    cleanup() {
        this.content.selectAll('*').remove();
        this.initialize();
    }

    initialize() {
    }

    orderSprints(sprints) {
        return _.reverse(sprints);
    }

    build(state, spinner) {
        this.content.classed('is-loaded', false);
        spinner.start();
        makeRequests(state, {
            sprints: this.orderSprints,
            links: true
        }).then((data) => {
            this.format(data, state);
            this.content.classed('is-loaded', true);
            spinner.stop();
        }).catch((error) => {
            spinner.stop();
            d3.select('#error-message')
                .classed('is-hidden', false)
                .text(this.locales.message("error-message", [error]));
            throw error;
        });
    }

    formatSprint(data, node, sprint_meta, meta=null, numeric=false) {
        node = d3.select(node);
        var type = null;
        if (meta === null) {
            type = data[0];
            data = data[1];
            node.attr('title', this.locales.attribute("sprint_meta", type));
        }
        else {
            type = getSprintMeta(sprint_meta, meta);
            data = data[type];
            if (numeric && sprint_meta.numeric.includes(type)) {
                return data;
            }
        }
        return sprint_meta.format[type](data, node);
    }

    formatFeature(key, value) {
        const unit = this.locales.retrieve(this.localization.short_units,
            key, "%s"
        );
        return value === undefined || value === null ?
            this.locales.message("no-value") :
            vsprintf(unit, [this.formatNumber(value)]);
    }

    getSprintUrl(d) {
        return `${config.jira_url}/secure/` + (d.board_id ?
            `GHLocateSprintOnBoard.jspa?sprintId=${d.sprint_id}&rapidViewId=${d.board_id}` :
            `GHGoToBoard.jspa?sprintId=${d.sprint_id}`
        );
    }
}

class Table extends Format {
    initialize() {
        this.content.append('table')
            .classed('table is-bordered is-striped', true);
    }

    format(data, state) {
        const table = this.content.select('table');
        const projects = table.selectAll('tbody')
            .data(data, d => d.project_name);
        projects.exit().remove();
        var newProjects = projects.enter()
            .append('tbody');
        const projectRow = newProjects.append('tr')
            .classed('project', true);

        const projectHeader = projectRow.append('th')
            .classed('name', true);
        projectHeader.append('a')
            .classed('board', true)
            .attr('target', '_blank');
        projectHeader.append('div')
            .classed('display-name', true);

        projects.select('tr.project');
        const updateProjects = newProjects.merge(projects).order();
        updateProjects.each((d, i, nodes) => {
            const sprintHeader = d3.select(nodes[i]).select('tr.project')
                .selectAll('th.sprint')
                .data(d => filterSprints(state, d.sprints), d => d.sprint_id);
            sprintHeader.exit().remove();
            const newSprint = sprintHeader.enter()
                .append('th')
                .classed('sprint', true);

            // Sprint link and tags
            newSprint.append('a')
                .classed('tooltip', true)
                .attr('target', '_blank');
            newSprint.append('span')
                .classed('tags', true)
                .classed('has-addons', true);

            newSprint.merge(sprintHeader).each((d, i, nodes) => {
                const meta = d3.select(nodes[i]).select('.tags')
                    .selectAll('.tag')
                    .data(d => _.toPairs(_.pick(d,
                        Array.from(state.sprint_meta.selected.rest())
                    )));
                meta.exit().remove();
                meta.enter().append('span').classed('tag', true).merge(meta)
                    .text((d, i, nodes) => this.formatSprint(d, nodes[i],
                        state.sprint_meta
                    ));
            });
        });

        updateProjects.selectAll('tr.project th.name .board')
            .attr('href', d => `${config.jira_url}/browse/${d.project_name}`)
            .text(d => d.project_name);
        updateProjects.selectAll('tr.project th.name .display-name')
            .text(d => d.display_name);
        updateProjects.selectAll('tr.project th.sprint a')
            .attr('href', d => this.getSprintUrl(d))
            .attr('data-tooltip', d => this.locales.message('sprint-title'))
            .text((d, i, nodes) => this.formatSprint(d, nodes[i],
                state.sprint_meta, "main"
            ));

        const features = updateProjects.selectAll('tr.feature')
            .data(
                d => sprintsToFeatures(filterSprints(state, d.sprints),
                    state.features.selected
                ),
                d => d.feature_key
            );

        features.exit().remove();
        const newFeatures = features.enter().append('tr')
            .classed('feature', true);
        newFeatures.append('td')
            .classed('name', true)
            .text(d => this.locales.retrieve(this.localization.descriptions,
                d.feature_key
            ));

        updateProjects.each((d, i, nodes) => {
            const item = d3.select(nodes[i]).selectAll('td.name');
            this.addSourceIcon(item, d, state);
        });

        const updateFeatures = newFeatures.merge(features).order();
        const cells = updateFeatures.selectAll('td.sprint')
            .data(d => d.sprints);
        cells.exit().remove();
        cells.enter()
            .append('td')
            .classed('sprint', true);
        updateFeatures.each((d, i, nodes) => {
            d3.select(nodes[i])
                .selectAll('td.sprint')
                .text(v => this.formatFeature(d.feature_key, v));
        });
    }

    addSourceIcon(item, data, state) {
        item.selectAll('a.icon').remove();
        item.append('a')
            .classed('icon tooltip is-tooltip-right', true)
            .attr('href', d => data.links[d.feature_key] ?
                data.links[d.feature_key].source : null
            )
            .attr('data-tooltip', this.locales.message('source-title'))
            .attr('target', '_blank')
            .classed('is-hidden', d => !data.links[d.feature_key])
            .append('i')
            .attr('class', d => {
                if (!data.links[d.feature_key]) {
                    return null;
                }
                const source = data.links[d.feature_key].type;
                if (this.localization.sources &&
                    this.localization.sources.icon &&
                    this.localization.sources.icon[source]
                ) {
                    return this.localization.sources.icon[source].join(' ');
                }
                return null;
            });

        const expand = this.locales.message('details-expand-title');
        const collapse = this.locales.message('details-collapse-title');
        item.append('a')
            .classed('icon tooltip is-tooltip-right', true)
            .classed('is-hidden', d => !data.details[d.feature_key])
            .attr('data-tooltip', this.locales.message('details-expand-title'))
            .on('click', (d, i, nodes) => {
                const icon = d3.select(nodes[i]);
                const sprints = d3.select(nodes[i].parentNode.parentNode)
                    .selectAll('td.sprint');

                const tables = sprints.selectAll('table.details');
                if (!tables.empty()) {
                    tables.transition()
                        .style("opacity", 0)
                        .remove();
                    icon.attr('data-tooltip', expand)
                        .select('i')
                        .classed('fa-expand', true)
                        .classed('fa-compress', false);
                    return;
                }

                const sprint_ids = _.map(filterSprints(state, data.sprints),
                    s => s.sprint_id
                );

                const table = sprints.append('table')
                    .classed('details table is-narrow', true)
                    .datum((s, j) => {
                        const sprint = data.details[d.feature_key][sprint_ids[j]];
                        return _.map(_.first(_.values(sprint)), (v, index) => {
                            return _.mapValues(sprint, z => z[index]);
                        });
                    });
                table.style("opacity", 0)
                    .transition()
                    .style("opacity", 1);
                table.append('tr').selectAll('th')
                    .data(t => _.sortBy(_.keys(t[0]), k => this.details[k].order))
                    .enter()
                    .append('th')
                    .text(k => this.locales.attribute("details", k));
                const detail = table.selectAll('tr.detail')
                    .data(t => {
                        const iteratees = _.map(
                            _.filter(_.keys(t[0]), k => this.details[k].sort),
                            k => (row) => this.details[k].sort(row[k])
                        );
                        return _.sortBy(t, iteratees);
                    })
                    .enter()
                    .append('tr')
                    .classed('detail', true);
                detail.selectAll('td')
                    .data(z => _.sortBy(_.toPairs(z), p => this.details[p[0]].order))
                    .enter()
                    .append('td')
                    .each((z, i, cell) => this.details[z[0]].format(d3.select(cell[i]), z[1]));

                icon.attr('data-tooltip', collapse)
                    .select('i')
                    .classed('fa-expand', false)
                    .classed('fa-compress', true);
            })
            .append('i')
            .classed('fas fa-expand', true);
    }
}

class Chart extends Format {
    initialize() {
        this.margin = {top: 20, right: 20, bottom: 30, left: 70};
        this.legendPadding = {top: 5, left: 5, right: 5, bottom: 5};
        this.tooltipPadding = {top: 5, left: 15, right: 15, bottom: 10};
        this.svgWidth = 960;
        this.svgHeight = 500;
        this.width = this.svgWidth - this.margin.left - this.margin.right;
        this.height = this.svgHeight - this.margin.top - this.margin.bottom;
        this.textHeight = 20;
        this.scheme = d3.schemeCategory10;
        this.pinTooltip = null;
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

    buildChartDimensions(content) {
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

        const newLegendHolder = newProjects.append("g")
            .classed("legend", true)
            .attr('transform', `translate(${this.width},0)`);
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
            .style("display", "none");

        const tooltip = focus.append("g")
            .classed("details", true);

        tooltip.append("rect")
            .attr("fill", "#000000")
            .attr("fill-opacity", 0.8)
            .attr("width", 150);

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
                    state.features.selected
                ),
                d => d.feature_key
            );

        features.exit().remove();

        const newFeatures = features.enter().append("g")
            .classed("feature", true);

        newFeatures.merge(features).order();

        return newFeatures;
    }

    updateLegends(state, updateProjects, config) {
        config = _.assign({}, {
            data: state.features.selected,
            text: d => this.locales.retrieve(this.localization.descriptions, d),
            header: true,
            sample: legend => legend.append("rect")
                .attr("x", -18)
                .attr("y", -8)
                .attr("width", 18)
                .attr("height", 4),
            sampleWidth: 18
        }, config);
        const legendHolders = updateProjects.select("g.legend");
        const legends = legendHolders.select("g.lines").selectAll("g.line")
            .data(config.data.size <= 1 ? [] : Array.from(config.data));
        const padding = this.legendPadding;

        legends.exit().remove();
        const legend = legends.enter()
            .append("g")
            .classed("line", true)
            .attr("transform", (d, i) => `translate(${-padding.right},${padding.top + (i + config.header) * this.textHeight})`);
        legend.attr("fill-opacity", 0)
            .transition()
            .duration(1000)
            .attr("fill-opacity", 1);

        config.sample(legend).classed("sample", true);

        legend.append("text")
            .attr("x", -config.sampleWidth - 2)
            .style("text-anchor", "end");

        const updateLegends = legends.merge(legend).order();
        updateLegends.each((d, i, nodes) => {
            const row = d3.select(nodes[i]);
            row.select(".sample")
                .style("fill", this.scheme[i % this.scheme.length]);
            row.select("text")
                .text(d => config.text(d));
        });

        legendHolders.each((d, i, nodes) => {
            const legendHolder = d3.select(nodes[i]);
            const boundingBox = legendHolder.select("g.lines").node().getBBox();
            legendHolder.select("rect.box")
                .transition()
                .duration(500)
                .attr("x", boundingBox.x - padding.left)
                .attr("y", boundingBox.y - padding.top)
                .attr("width", boundingBox.width + padding.left + padding.right)
                .attr("height", config.data.size <= 1 ?
                    config.header * (this.textHeight + padding.top + padding.bottom) :
                    (config.data.size + config.header) * this.textHeight +
                    padding.top + padding.bottom
                );
        });
    }

    updateFocus(chart, data, state, sprints, y, callbacks) {
        callbacks = _.assign({}, {
            range: () => d3.scaleLinear()
                .range(linspace(0, this.width, sprints.length))
                .domain(_.range(sprints.length)),
            mouseIndex: x => Math.round(x),
            select: (i, j, target) => undefined,
            focus: (focusHolder, i, pos) => i,
            filter: (features) => features,
            highlight: (d, i, feature) => d[1] === feature,
            format: (key, value, node) => value,
            has_source: (d, i) => {
                return i === 0 || state.features.selected.includes(d[0]);
            },
            link: (d, i, feature) => {
                if (state.sprint_meta.selected.includes(d[0])) {
                    return {
                        source: this.getSprintUrl(sprints[i])
                    };
                }
                return data.links[d[0]];
            }
        }, callbacks);
        const focusHolder = chart.select('.focus');

        var x1 = callbacks.range();

        const selectFeature = (eventTarget) => {
            const target = d3.mouse(eventTarget);
            const j = y.invert(target[1]);
            var i = callbacks.mouseIndex(x1.invert(target[0]));
            var feature = callbacks.select(i, j, target);
            if (_.isObject(feature)) {
                ({ feature, i } = feature);
            }
            return {target, i, j, feature};
        };

        const showTooltip = (i, feature) => {
            const pos = typeof feature === "undefined" ? 0 : y(feature);
            i = callbacks.focus(focusHolder, i, pos);

            const tooltip = focusHolder.selectAll('.details');
            const missing = typeof sprints[i] === "undefined";
            tooltip.classed("is-hidden", missing);
            if (missing) {
                return;
            }

            const text = tooltip.select("text");
            tooltip.selectAll("path.icon").remove();
            const meta = text.selectAll("tspan")
                .data(_.toPairs(_.pick(sprints[i], callbacks.filter(
                    _.concat(Array.from(state.sprint_meta.selected),
                        Array.from(state.features.selected)
                    )
                ))));
            meta.exit().remove();
            meta.enter().append("tspan")
                .attr('x', this.tooltipPadding.left)
                .attr('dy', '1.2em')
                .attr('style', 'font-size: 0.8em')
                .merge(meta).order()
                .classed("has-source", (d, i) => callbacks.has_source(d, i))
                .classed("highlight", d => callbacks.highlight(d, i, feature))
                .text((d, j, nodes) => {
                    if (state.sprint_meta.selected.includes(d[0])) {
                        return this.formatSprint(d, nodes[i],
                            state.sprint_meta
                        );
                    }
                    if (state.features.selected.includes(d[0])) {
                        return this.locales.message("feature-tooltip", [
                            this.locales.retrieve(this.localization.descriptions, d[0]),
                            this.formatFeature(d[0], d[1])
                        ]);
                    }
                    return callbacks.format(d[0], d[1], nodes[i]);
                })
                .each((d, j, nodes) => {
                    const source = callbacks.link(d, i).type;
                    if (source && this.localization.sources &&
                        this.localization.sources.icon &&
                        this.localization.sources.icon[source]
                    ) {
                        const icon = this.localization.sources.icon[source];
                        const packs = {fab: "brands", fas: "solid"};
                        const adjust = {
                            iconWidth: 512,
                            scale: 0.025,
                            width: 20,
                            height: 16.25
                        };
                        /* jshint ignore:start */
                        import(
                            `@fortawesome/free-${packs[icon[0]]}-svg-icons/${_.camelCase(icon[1])}.js`
                        ).then(fa => {
                            tooltip.append("path")
                                .classed("icon", true)
                                .attr("d", fa.svgPathData)
                                .attr("transform", `translate(${this.tooltipPadding.left + (adjust.iconWidth - fa.width) * 0.5 * adjust.scale}, ${this.tooltipPadding.top + adjust.height * j}) scale(${adjust.scale})`);
                            d3.select(nodes[j])
                                .classed("has-icon", true)
                                .attr('x', this.tooltipPadding.left + adjust.width);
                        });
                        /* jshint ignore:end */
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
        };

        const updateFocusPosition = (target, datum) => {
            focusHolder.classed("fixed", _.isEqual(datum, [0]))
                .datum(datum)
                .selectAll(".details")
                .attr("transform", `translate(${target[0]}, ${target[1]})`)
                .datum(target);
        };

        this.pinTooltip = (eventTarget) => {
            const { target, i, feature } = selectFeature(eventTarget);
            const tooltip = focusHolder.selectAll(".details");
            const rect = tooltip.select("rect");
            const pos = tooltip.datum();
            const fixed = _.isEqual(focusHolder.datum(), [0]);
            if (fixed) {
                if (target[0] >= pos[0] &&
                    target[0] <= pos[0] + Number(rect.attr("width")) &&
                    target[1] >= pos[1] &&
                    target[1] <= pos[1] + Number(rect.attr("height"))) {
                    // Clicking inside of tooltip
                    const meta = tooltip.selectAll("tspan")
                        .filter((d, j, nodes) => {
                            const meta = d3.select(nodes[j]);
                            if (!meta.classed("has-source")) {
                                return false;
                            }
                            const bbox = nodes[j].getBoundingClientRect();
                            const cbox = d3.select(".overlay").node().getBoundingClientRect();
                            return target[0] >= bbox.left - cbox.x -
                                (meta.classed("has-icon") ? 20 : 0) &&
                                target[0] <= bbox.right - cbox.x &&
                                target[1] >= bbox.top - cbox.y &&
                                target[1] <= bbox.bottom - cbox.y;
                        });
                    if (!meta.empty()) {
                        const link = callbacks.link(meta.datum(), i, feature);
                        if (link) {
                            const source = d3.select(document.body)
                                .append('a')
                                .classed('is-hidden', true)
                                .attr('target', '_blank')
                                .attr('href', link.source);
                            source.node().click();
                            source.remove();
                        }
                    }
                    return;
                }
            }
            updateFocusPosition(target, fixed ? [i, feature] : [0]);
            showTooltip(i, feature);
        };

        chart.select('.overlay')
            .on("mouseover.tooltip", () => focusHolder.style("display", null))
            .on("mouseout.tooltip", () => {
                if (!_.isEqual(focusHolder.datum(), [0])) {
                    focusHolder.style("display", "none");
                }
                focusHolder.datum(null);
            })
            .on("mousemove.tooltip", () => {
                const datum = focusHolder.datum();
                if (_.isEqual(datum, [0])) {
                    return;
                }
                const { target, i, feature } = selectFeature(d3.event.currentTarget);

                updateFocusPosition(target, [i, feature]);
                if (_.isEqual(datum, [i, feature])) {
                    return;
                }
                showTooltip(i, feature);
            })
            .on("mouseup.tooltip", () => {
                this.pinTooltip(d3.event.currentTarget);
            });
    }

    updateAxes(chart, state, d, x, y) {
        chart.select('.axis.x')
            .call(d3.axisBottom(x)
                .tickValues(x.domain())
                .tickFormat((i, j, nodes) => this.formatSprint(d.sprints[i],
                    nodes[j], state.sprint_meta,
                    state.sprint_meta.changed ? "main" : "sprint_num", true
                ))
            );
        chart.select('.axis.y')
            .call(d3.axisLeft(y));

        chart.select('.label.y')
            .text(state.features.selected.size === 1 ?
                this.locales.retrieve(this.localization.descriptions,
                    state.features.selected.first()
                ) :
                this.locales.message("features-header")
            );
        chart.select('.label.x')
            .text(this.locales.attribute("sprint_meta",
                getSprintMeta(state.sprint_meta,
                    state.sprint_meta.changes ? "main" : "sprint_num"
                )
            ));
    }
}

class LineChart extends Chart {
    orderSprints(sprints) {
        return sprints;
    }

    format(data, state) {
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

        updateProjects.each((d, i, nodes) => {
            const chart = d3.select(nodes[i]);
            const sprints = filterSprints(state, d.sprints);
            const data = sprintsToFeatures(sprints, state.features.selected);

            var x = d3.scaleOrdinal()
                .range(linspace(0, this.width, sprints.length))
                .domain(_.range(sprints.length));

            var y = d3.scaleLinear()
                .rangeRound([this.height, 0])
                .domain(d3.extent(_.flatten(_.map(data, "sprints"))));

            this.updateFocus(chart, d, state, sprints, y, {
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
                    return i;
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
                        .transition()
                        .duration(1000)
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
                        .transition()
                        .duration(1000)
                        .attr("fill-opacity", 1);
                });
        });
    }
}

class BarChart extends Chart {
    orderSprints(sprints) {
        return sprints;
    }

    format(data, state) {
        var {projects, newProjects, newCharts} = this.createCharts(data);

        newProjects.insert("g", "g.legend")
            .classed("features", true);

        this.createFocus(newProjects);

        const updateProjects = newCharts.merge(projects).order()
            .select("g");

        this.updateLegends(state, updateProjects);

        this.createFeatures(state, updateProjects);

        updateProjects.each((d, i, nodes) => {
            const chart = d3.select(nodes[i]);
            const sprints = filterSprints(state, d.sprints);
            const data = sprintsToFeatures(sprints, state.features.selected);

            var x = d3.scaleBand()
                .range([0, this.width])
                .domain(_.range(sprints.length))
                .paddingInner(1 / (state.features.selected.size * 2));

            var y = d3.scaleLinear()
                .rangeRound([this.height, 0])
                .domain(d3.extent(_.flatten(_.map(data, "sprints"))));

            this.updateFocus(chart, d, state, sprints, y, {
                range: () => d3.scaleLinear()
                    .range(_.range(x.bandwidth() / 2, this.width + x.bandwidth() / 2, x.step()))
                    .domain(_.range(sprints.length)),
                select: (i, j, target) => {
                    const features = _.map(data, f => f.sprints[i]);
                    const bandPos = target[0] % x.step();
                    const pos = bandPos / (x.bandwidth() / state.features.selected.size);
                    const idx = Math.floor(pos);
                    return features[idx];
                }
            });
            this.updateAxes(chart, state, d, x, y);

            chart.select("g.features").selectAll("g.feature")
                .each((f, j, features) => {
                    const feature = d3.select(features[j]);
                    const bars = feature.selectAll("rect")
                        .data(f.sprints);

                    bars.exit().remove();
                    bars.enter().append("rect")
                        .attr("y", this.height)
                        .attr("height", 0)
                        .style("fill", this.scheme[j % this.scheme.length])
                        .merge(bars)
                        .transition()
                        .duration(500)
                        .attr("x", (g, i) => x(i) + x.bandwidth() / features.length * j)
                        .attr("width", x.bandwidth() / features.length)
                        .transition()
                        .duration(500)
                        .attr("y", g => y(g))
                        .attr("height", g => this.height - y(g))
                        .style("fill", this.scheme[j % this.scheme.length]);
                });
        });
    }
}

class ScatterPlot extends Chart {
    initialize() {
        super.initialize();
        const { newProjects } = this.buildChartDimensions(this.content);
        newProjects.append("g")
            .classed("features", true)
            .attr("stroke-width", 2.5)
            .attr("fill", "none");
        newProjects.append("g")
            .classed("clusters", true);
        const { focus, overlay } = this.createFocus(newProjects);
        this.focusCircle = focus.append("circle")
            .attr("r", 3)
            .style("fill", "black")
            .classed("is-hidden", true);

        overlay.remove();
        this.x = null;
        this.y = null;
        this.idleTimeout = null;
        this.brushing = false;
        this.zooming = false;
        this.brush = d3.brush()
            .on("start", () => {
                this.brushing = true;
                setTimeout(() => {
                    if (this.brushing || this.zooming) {
                        focus.selectAll(".details").classed("is-hidden", true);
                        this.focusCircle.classed("is-hidden", true);
                    }
                }, 100);
            })
            .on("end", () => {
                this.brushing = false;
                this.endBrush();
                if (this.pinTooltip !== null && d3.event.sourceEvent !== null &&
                    typeof d3.event.sourceEvent.originalTarget !== "undefined"
                ) {
                    this.pinTooltip(d3.event.sourceEvent.originalTarget);
                }
            });
        newProjects.append("g")
            .classed("brush", true)
            .call(this.brush);
    }

    endBrush() {
        if (this.x === null) {
            return;
        }

        const selection = d3.event.selection;
        const idleDelay = 350;
        const x = this.x.scale;
        const y = this.y.scale;
        if (selection) {
            const clip = [Math.max, Math.min];
            x.domain(_.map([selection[0][0], selection[1][0]],
                (value, i) => clip[i](x.invert(value), this.x.domain[i])
            ));
            y.domain(_.map([selection[1][1], selection[0][1]],
                (value, i) => clip[i](y.invert(value), this.y.domain[i])
            ));
            this.content.select('svg .brush').call(this.brush.move, null);
        }
        else {
            if (!this.idleTimeout) {
                this.idleTimeout = setTimeout(() => {this.idleTimeout = null;},
                    idleDelay
                );
                return;
            }
            x.domain(this.x.domain);
            y.domain(this.y.domain);
        }
        this.zoom();
    }

    pointInDomain(point) {
        const xDomain = this.x.scale.domain();
        const yDomain = this.y.scale.domain();
        return (
            point[this.x.feature] >= xDomain[0] &&
            point[this.x.feature] <= xDomain[1] &&
            point[this.y.feature] >= yDomain[0] &&
            point[this.y.feature] <= yDomain[1]
        );
    }

    zoom() {
        this.zooming = true;
        const chart = this.content.select('svg');
        const t = chart.transition().duration(750);
        chart.select(".axis.x").transition(t).call(this.x.axis);
        chart.select(".axis.y").transition(t).call(this.y.axis);
        const circles = chart.select("g.features")
            .selectAll("circle");
        circles.transition(t)
            .attr("cx", d => this.x.scale(d[this.x.feature]))
            .attr("cy", d => this.y.scale(d[this.y.feature]))
            .style("stroke-opacity", d => this.pointInDomain(d) ? 1 : 0)
            .on("end", () => {
                this.zooming = false;
            });
        chart.select("g.clusters")
            .selectAll("text").transition(t)
            .attr("x", d => this.x.scale(d.x))
            .attr("y", d => this.y.scale(d.y))
            .on("end", () => {
                this.updateClusters(circles);
            });
    }

    updateClusters(circles) {
        const groups = _.reduce(circles.nodes(), (accumulator, circle, i) => {
            const group = circles.filter((d, j, nodes) => {
                if (!this.pointInDomain(d)) {
                    return false;
                }
                const distance =
                    Math.abs(circle.getAttribute("cx") - nodes[j].getAttribute("cx")) +
                    Math.abs(circle.getAttribute("cy") - nodes[j].getAttribute("cy"));
                return distance < 25;
            });
            if (group.size() > 1) {
                const data = group.data();
                const cluster = {
                    items: Set(_.each(data, d => d.sprint_id)),
                    x: _.meanBy(data, d => d[this.x.feature]),
                    y: _.meanBy(data, d => d[this.y.feature])
                };
                const other = _.find(accumulator, c => {
                    return Math.abs(this.x.scale(cluster.x) - this.x.scale(c.x)) +
                        Math.abs(this.y.scale(cluster.y) - this.y.scale(c.y)) < 50;
                });
                if (typeof other !== "undefined") {
                    const w1 = other.items.size;
                    const w2 = cluster.items.size;
                    other.x = (w1 * other.x + w2 * cluster.x) / (w1 + w2);
                    other.y = (w1 * other.y + w2 * cluster.y) / (w1 + w2);
                    other.items = cluster.items.union(other.items);
                }
                else {
                    accumulator.push(cluster);
                }
            }
            return accumulator;
        }, []);

        const clusters = this.content.select('svg g.clusters')
            .selectAll("text")
            .data(groups);
        clusters.exit().remove();
        clusters.enter().append("text")
            .merge(clusters)
            .style("font-size", d => `${0.75 + d.items.size / circles.size()}em`)
            .attr("dy", d => `${0.375 + 0.5 * d.items.size / circles.size()}em`)
            .attr("x", d => this.x.scale(d.x))
            .attr("y", d => this.y.scale(d.y))
            .text(d => d.items.size);
    }

    build(state, spinner) {
        super.build(state, spinner);
        d3.select(`svg#${spinner.config.id}`).classed('is-overlay', true);
    }

    format(data, state) {
        const chart = this.content.select('svg');

        // Select features
        const features = Array.from(state.features.selected.slice(0, 2));
        const points = features.length < 2 ? [] : _.flatten(_.map(data,
            (project, i) => _.map(project.sprints,
                sprint => _.assign({}, _.pick(sprint, _.concat(
                    Array.from(state.features.selected),
                    Array.from(state.sprint_meta.selected),
                    ["sprint_id", "board_id"]
                )), {
                    project: i,
                    project_key: project.project_name,
                    project_name: project.display_name || project.project_name
                })
            )
        ));

        // Alter legend with projects
        this.updateLegends(state, chart, {
            data: state.projects.selected,
            text: d => d,
            header: false,
            sample: legend => legend.append("circle")
                .attr("r", 4)
                .attr("cx", -5)
                .attr("cy", -6),
            sampleWidth: 8
        });

        // Update points
        const circles = chart.select("g.features").selectAll("circle")
            .data(points);

        const xDomain = d3.extent(_.map(points, features[0]));
        const yDomain = d3.extent(_.map(points, features[1]));

        const legendWidth = chart.select('.legend g.lines')
            .node().getBBox().width +
            this.legendPadding.left + this.legendPadding.right + 10;
        var x = d3.scaleLinear()
            .rangeRound([0, this.width - legendWidth])
            .domain(xDomain);

        var y = d3.scaleLinear()
            .rangeRound([this.height, 0])
            .domain(yDomain);

        this.x = {
            scale: x,
            domain: xDomain,
            axis: d3.axisBottom(x),
            feature: features[0]
        };

        this.y = {
            scale: y,
            domain: yDomain,
            axis: d3.axisLeft(y),
            feature: features[1]
        };

        circles.exit().remove();
        circles.enter().append("circle")
            .attr("r", 5)
            .classed("is-hidden", d => isNaN(d[features[0]]) || isNaN(d[features[1]]))
            .merge(circles)
            .style("stroke", d => this.scheme[d.project % this.scheme.length])
            .attr("cx", d => x(d[features[0]]))
            .attr("cy", d => y(d[features[1]]))
            .call((nodes) => this.updateClusters(nodes));

        // Update Focus with callbacks for individual/multiple points
        this.updateFocus(chart, data, state, points, y, {
            range: () => x,
            mouseIndex: pos => pos,
            select: (i, j) => {
                if (this.zooming || points.length === 0 || features.length < 2) {
                    return [0, undefined];
                }
                const iScaled = x(i);
                const jScaled = y(j);
                const minimalPoint = _.reduce(points,
                    (minimal, point, index) => {
                        if (!this.pointInDomain(point)) {
                            return minimal;
                        }
                        const distance =
                            Math.abs(x(point[features[0]]) - iScaled) +
                            Math.abs(y(point[features[1]]) - jScaled);
                        if (distance < minimal.distance) {
                            return {
                                distance: distance,
                                i: point[features[0]],
                                feature: point[features[1]]
                            };
                        }
                        return minimal;
                    },
                    {distance: Infinity, i: undefined, feature: undefined}
                );
                return minimalPoint;
            },
            focus: (focusHolder, i, pos) => {
                if (this.zooming || points.length === 0 || features.length < 2) {
                    this.focusCircle.classed("is-hidden", true);
                    return -1;
                }
                this.focusCircle.classed("is-hidden", false)
                    .attr("cx", x(i))
                    .attr("cy", pos);
                return _.findIndex(points,
                    point => y(point[features[1]]) === pos &&
                        point[features[0]] === i
                );
            },
            filter: features => _.concat(["project_name"], features),
            highlight: (d, i, feature) => d[1] === points[i][features[0]] ||
                d[1] === points[i][features[1]],
            has_source: (d, i) => {
                return i <= 1 || state.features.selected.includes(d[0]);
            },
            link: (d, i, feature=null) => {
                const p = feature === null ? points[i] : _.find(points,
                    point => point[features[1]] === feature &&
                        point[features[0]] === i
                );
                if (typeof p === "undefined") {
                    return {};
                }
                if (d[0] === "project_name") {
                    return {
                        source: `${config.jira_url}/browse/${p.project_key}`
                    };
                }
                if (state.sprint_meta.selected.includes(d[0])) {
                    return {source: this.getSprintUrl(p)};
                }
                return data[p.project].links[d[0]];
            }
        });

        // Update axis and scale
        chart.select(".axis.x")
            .transition().duration(500)
            .call(this.x.axis);
        chart.select('.axis.y')
            .call(this.y.axis);

        chart.select('.label.x')
            .text(features.length >= 1 ?
                this.locales.retrieve(this.localization.descriptions,
                    features[0]
                ) :
                this.locales.message("features-header")
            );
        chart.select('.label.y')
            .text(features.length >= 2 ?
                this.locales.retrieve(this.localization.descriptions,
                    features[1]
                ) :
                this.locales.message("features-header")
            );
    }
}

export default { Table, LineChart, BarChart, ScatterPlot };
