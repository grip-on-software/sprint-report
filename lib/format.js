import _ from 'lodash';
import * as d3 from 'd3';
import axios from 'axios';
import {vsprintf} from 'sprintf-js';
import config from 'config.json';

const filterSprints = function(state, sprints) {
    if (state.sprints.closedOnly) {
        sprints = _.filter(sprints, d => d.sprint_is_closed);
    }
    return state.sprints.showOld ? sprints :
        _.take(sprints, state.sprints.current);
};

const requestsToSprints = function(requests, auxiliaryKeys) {
    return _.reduce(_.zipObject(auxiliaryKeys, requests),
        (result, request, key) => key === "old" ?
            _.concat(request.data, result) :
            _.zipWith(result, request.data,
                (target, auxiliary) => _.assign({}, target, 
                    key === "" ? auxiliary : _.fromPairs([[key, auxiliary]])
                )
            ),
        []
    );
};

const sprintsToFeatures = function(sprints, features) {
    return _.map(Array.from(features), (feature) => {
        return {
            "feature_key": feature,
            "sprints": _.map(sprints, feature)
        };
    });
};

const linspace = function(start, stop, nsteps) {
    const delta = (stop - start) / (nsteps - 1);
    return d3.range(nsteps).map(i => start + i * delta);
};

class Format {
    constructor(locales, localization) {
        this.locales = locales;
        this.localization = localization;
        this.content = d3.select('#format-content');
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
        const selectedProjects = Array.from(state.projects.selected);
        const auxiliaryKeys = _.concat("",
            _.difference(Array.from(state.features.selected),
                state.features.default
            ), state.sprints.showOld ? "old" : [], "links"
        );
        spinner.start();
        axios.all(_.flatten(_.map(selectedProjects, project => {
            return _.map(auxiliaryKeys, feature => {
                return axios.get(`data/${project}/${feature === "" ? "default" : feature}.json`);
            });
        }))).then((requests) => {
            const projectRequests = _.zip(selectedProjects,
                _.chunk(requests, auxiliaryKeys.length)
            );

            const data = _.map(projectRequests, (project) => {
                return {
                    "project_name": project[0],
                    "display_name": state.projects.display_names[project[0]] || "",
                    "sprints": this.orderSprints(requestsToSprints(_.initial(project[1]),
                        _.initial(auxiliaryKeys))
                    ),
                    "links": _.last(project[1]).data,
                    "meta": Array.from(state.sprint_meta.selected)
                };
            });

            this.format(data, state);
            spinner.stop();
        }).catch((error) => {
            spinner.stop();
            d3.select('#error-message')
                .classed('is-hidden', false)
                .text(this.locales.message("error-message", [error]));
            throw error;
        });
    }

    getSprintMeta(sprint_meta, meta) {
        if (meta === "main") {
            return sprint_meta.selected.isEmpty() ?
                sprint_meta.known[0] : sprint_meta.selected.first();
        }
        return meta;
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
            type = this.getSprintMeta(sprint_meta, meta);
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
            vsprintf(unit, [value]);
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

            newSprint.append('a')
                .attr('target', '_blank');
            const sprintTags = newSprint.append('span')
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
            .attr('href', d => `${config.jira_url}/secure/` + (d.board_id ?
                `GHLocateSprintOnBoard.jspa?sprintId=${d.sprint_id}&rapidViewId=${d.board_id}` :
                `GHGoToBoard.jspa?sprintId=${d.sprint_id}`
            ))
            .attr('title', d => this.locales.message('sprint-title'))
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
            this.addSourceIcon(d3.select(nodes[i]).selectAll('td.name'),
                d.links
            );
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

    addSourceIcon(item, links) {
        item.selectAll('a.icon').remove();
        item.append('a')
            .classed('icon', true)
            .attr('href', d => links[d.feature_key] ?
                links[d.feature_key].source : null
            )
            .attr('target', '_blank')
            .classed('is-hidden', d => !links[d.feature_key])
            .append('i')
            .attr('class', d => {
                if (!links[d.feature_key]) {
                    return null;
                }
                const source = links[d.feature_key].type;
                if (this.localization.sources &&
                    this.localization.sources.icon &&
                    this.localization.sources.icon[source]
                ) {
                    return this.localization.sources.icon[source].join(' ');
                }
                return null;
            });
    }
}

class LineChart extends Format {
    initialize() {
        this.content.append('div');
    }

    orderSprints(sprints) {
        return sprints;
    }

    format(data, state) {
        const margin = {top: 20, right: 20, bottom: 30, left: 70},
            textHeight = 20,
            svgWidth = 960,
            svgHeight = 500,
            width = svgWidth - margin.left - margin.right,
            height = svgHeight - margin.top - margin.bottom;

        const projects = this.content.selectAll('svg')
            .data(data, d => d.project_name);
        projects.exit().remove();
        var newCharts = projects.enter()
            .append('svg')
            .classed('chart', true)
            .attr('width', svgWidth + textHeight)
            .attr('height', svgHeight + textHeight);
        var newProjects = newCharts.append("g")
            .attr("transform", `translate(${margin.left}, ${margin.top})`);

        newProjects.append("g")
            .classed("axis x", true)
            .attr("transform", `translate(0, ${height})`);

        newProjects.append("text")
            .classed("label x", true)
            .attr("transform", `translate(${width / 2}, ${height + margin.top + textHeight})`)
            .style("text-anchor", "middle");

        newProjects.append("g")
            .classed("axis y", true);

        newProjects.append("text")
            .classed("label y", true)
            .attr("transform", "rotate(-90)")
            .attr("y", -margin.left + textHeight)
            .attr("x", -height / 2)
            .style("text-anchor", "middle");

        const newHolder = newProjects.append("g")
            .classed("legend", true)
            .attr('transform', "translate(" + width + ",0)");
        newHolder.append("rect")
            .classed("box", true)
            .attr("stroke", "#000000")
            .attr("fill", "#000000")
            .attr("fill-opacity", 0.1);
        newHolder.append("g")
            .classed("header", true)
            .append("text")
            .classed("label", true)
            .style("text-anchor", "end")
            .text(d => d.display_name || d.project_name);

        newProjects.append("g")
            .classed("features", true);

        const focus = newProjects.append("g")
            .classed("focus", true)
            .style("display", "none");

        focus.append("circle")
            .attr("r", 6);

        const tooltip = focus.append("g")
            .classed("tooltip", true);

        tooltip.append("rect")
            .attr("fill", "#000000")
            .attr("fill-opacity", 0.8)
            .attr("width", 150);

        tooltip.append("text")
            .attr("x", 15)
            .attr("y", 5)
            .attr("dy", ".31em");

        focus.append("line")
            .attr("y1", 5)
            .attr("y2", height);

        newProjects.append("g")
            .attr("pointer-events", "all")
            .append("rect")
            .classed("overlay", true)
            .attr("pointer-events", "all")
            .attr("fill", "none")
            .attr("x", 0)
            .attr("y", 0)
            .attr("width", width)
            .attr("height", height);

        const updateProjects = newCharts.merge(projects).order()
            .select("g");

        const legendHolder = updateProjects.select("g.legend");
        const legends = legendHolder.selectAll("g.line")
            .data(state.features.selected.size === 1 ? [] :
                Array.from(state.features.selected)
            );

        legends.exit().remove();
        const legend = legends.enter()
            .append("g")
            .classed("line", true)
            .attr("transform", (d, i) => `translate(0,${10 + i * textHeight})`);
        legend.attr("fill-opacity", 0)
            .transition()
            .duration(1000)
            .attr("fill-opacity", 1);

        legend.append("rect")
            .attr("x", -18)
            .attr("y", 6)
            .attr("width", 18)
            .attr("height", 4);

        legend.append("text")
            .attr("x", -20)
            .attr("y", 9)
            .attr("dy", ".35em")
            .style("text-anchor", "end");

        const scheme = d3.schemeCategory10;
        const updateLegends = legends.merge(legend).order();
        updateLegends.each((d, i, nodes) => {
            const row = d3.select(nodes[i]);
            row.select("rect")
                .style("fill", scheme[i % scheme.length]);
            row.select("text")
                .text(d => this.locales.retrieve(this.localization.descriptions, d));
        });

        legendHolder.each((d, i, nodes) => {
            const boundingBox = nodes[i].getBBox();
            d3.select(nodes[i]).select("rect.box")
                .transition()
                .duration(500)
                .attr("x", boundingBox.x)
                .attr("y", boundingBox.y)
                .attr("width", boundingBox.width)
                .attr("height", state.features.selected.size === 1 ? 0 :
                    10 + (state.features.selected.size + 1) * textHeight
                );
        });

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

        newFeatures.append("path")
            .attr("fill", "none")
            .attr("stroke-linejoin", "round")
            .attr("stroke-linecap", "round")
            .attr("stroke-width", 1.5);

        newFeatures.merge(features).order();

        updateProjects.each((d, i, nodes) => {
            const chart = d3.select(nodes[i]);
            const data = sprintsToFeatures(filterSprints(state, d.sprints),
                state.features.selected
            );

            var x1 = d3.scaleLinear()
                .range(linspace(0, width, d.sprints.length))
                .domain(_.range(d.sprints.length));

            var x = d3.scaleOrdinal()
                .range(linspace(0, width, d.sprints.length))
                .domain(_.range(d.sprints.length));

            var y = d3.scaleLinear()
                .rangeRound([height, 0])
                .domain(d3.extent(_.flatten(_.map(data, "sprints"))));

            const focusHolder = chart.select('.focus');

            chart.select('.overlay')
                .on("mouseover", () => focusHolder.style("display", null))
                .on("mouseout", () => focusHolder.style("display", "none"))
                .on("mousemove", () => {
                    const target = d3.mouse(d3.event.currentTarget);
                    const i = Math.round(x1.invert(target[0]));
                    const j = y.invert(target[1]);
                    const features = _.map(data, f => f.sprints[i]);
                    const feature = _.minBy(features, g => Math.abs(g - j));
                    const tooltip = focusHolder.select(".tooltip")
                        .attr("transform", `translate(${target[0]}, ${target[1]})`);
                    if (_.isEqual(focusHolder.datum(), [i, feature])) {
                        return;
                    }
                    focusHolder.datum([i, feature]);
                    focusHolder.select("circle")
                        .attr("cx", x(i))
                        .attr("cy", y(feature));
                    focusHolder.select("line")
                        .attr("x1", x(i))
                        .attr("x2", x(i))
                        .attr("y1", y(feature) + 2);
                    const text = tooltip.select("text");
                    const meta = text.selectAll("tspan")
                        .data(_.toPairs(_.pick(d.sprints[i],
                            Array.from(state.sprint_meta.selected.union(state.features.selected))
                        )));
                    meta.exit().remove();
                    meta.enter().append("tspan")
                        .attr('x', 15)
                        .attr('dy', '1.2em')
                        .attr('style', 'font-size: 0.8em')
                        .merge(meta).order()
                        .classed("highlight", d => d[1] === feature)
                        .text((d, i, nodes) => state.sprint_meta.selected.includes(d[0]) ? 
                            this.formatSprint(d, nodes[i], state.sprint_meta) :
                            this.locales.message("feature-tooltip", [
                                this.locales.retrieve(this.localization.descriptions, d[0]),
                                this.formatFeature(d[0], d[1])
                            ])
                        );
                    const bbox = text.node().getBBox();
                    tooltip.select("rect")
                        .attr("width", bbox.width + 30)
                        .attr("height", bbox.height + 15);
                });

            chart.select('.axis.x')
                .call(d3.axisBottom(x)
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
                    this.getSprintMeta(state.sprint_meta, "main")
                ));

            const line = d3.line()
                .defined(g => g !== undefined && g !== null)
                .x((g, i) => x(i))
                .y(g => y(g))
                .curve(d3.curveMonotoneX);

            chart.select("g.features").selectAll("g.feature")
                .each((f, j, features) => {
                    const feature = d3.select(features[j]);
                    feature.select("path")
                        .attr("stroke", scheme[j % scheme.length])
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
                        .attr("fill", scheme[j % scheme.length])
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

export default { Table, LineChart };
