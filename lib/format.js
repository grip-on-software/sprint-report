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
        const updateProjects = newProjects.merge(projects);
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
                        Array.from(state.sprint_meta.selected)
                    )));
                meta.exit().remove();
                meta.enter().append('span').classed('tag', true).merge(meta)
                    .each((d, i, nodes) => this.formatSprint(d, nodes[i],
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
            .each((d, i, nodes) => this.formatSprint(d, nodes[i],
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

        const updateFeatures = newFeatures.merge(features);
        const cells = updateFeatures.selectAll('td.sprint')
            .data(d => d.sprints);
        cells.exit().remove();
        cells.enter()
            .append('td')
            .classed('sprint', true);
        updateFeatures.each((d, i, nodes) => {
            const unit = this.locales.retrieve(this.localization.short_units,
                d.feature_key, "%s"
            );
            d3.select(nodes[i])
                .selectAll('td.sprint')
                .text(d => d === undefined || d === null ?
                    this.locales.message("no-value") :
                    vsprintf(unit, [d]));
        });
    }

    formatSprint(data, node, sprint_meta, meta=null) {
        node = d3.select(node);
        var type = null;
        if (meta === null) {
            type = data[0];
            data = data[1];
            node.attr('title', this.locales.attribute("sprint_meta", meta));
        }
        else {
            type = sprint_meta[meta];
            data = data[type];
        }
        return sprint_meta.format[type](data, node);
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
        var newProjects = projects.enter()
            .append('svg')
            .attr('width', svgWidth + textHeight)
            .attr('height', svgHeight + textHeight)
            .append("g")
            .attr("transform", `translate(${margin.left}, ${margin.top})`);

        newProjects.append("g")
            .classed("axis x", true)
            .attr("transform", `translate(0, ${height})`);

        newProjects.append("text")
            .classed("label x", true)
            .attr("transform", `translate(${width / 2}, ${height + margin.top + textHeight})`)
            .style("text-anchor", "middle")
            .text(this.locales.attribute("sprint_meta",
                state.sprint_meta.extra[0]
            ));

        newProjects.append("g")
            .classed("axis y", true);

        newProjects.append("text")
            .classed("label y", true)
            .attr("transform", "rotate(-90)")
            .attr("y", -margin.left + textHeight)
            .attr("x", -height / 2)
            .style("text-anchor", "middle");

        newProjects.append("g")
            .classed("legend", true)
            .attr('transform', "translate(" + width + ",0)")
            .append("g")
            .classed("header", true)
            .append("text")
            .style("text-anchor", "end")
            .text(d => d.display_name || d.project_name);

        const updateProjects = newProjects.merge(projects.select('g'));

        const legends = updateProjects.select('g.legend')
            .selectAll('g.line')
            .data(Array.from(state.features.selected));

        legends.exit().remove();
        const legend = legends.enter()
            .append("g")
            .classed("line", true)
            .attr("transform", (d, i) => `translate(0,${10 + i * textHeight})`);

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
        const updateLegends = legends.merge(legend);
        updateLegends.each((d, i, nodes) => {
            const row = d3.select(nodes[i]);
            row.select("rect")
                .classed("is-hidden", state.features.selected.size === 1)
                .style("fill", scheme[i % scheme.length]);
            row.select("text")
                .classed("is-hidden", state.features.selected.size === 1)
                .text(d => this.locales.retrieve(this.localization.descriptions, d));
        });

        const features = updateProjects.selectAll("g.feature")
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

        updateProjects.each((d, i, nodes) => {
            const chart = d3.select(nodes[i]);
            const data = sprintsToFeatures(filterSprints(state, d.sprints),
                state.features.selected
            );

            var x = d3.scaleOrdinal()
                .range(linspace(0, width, d.sprints.length))
                .domain(_.map(d.sprints, state.sprint_meta.extra[0]));

            var y = d3.scaleLinear()
                .rangeRound([height, 0])
                .domain(d3.extent(_.flatten(_.map(data, "sprints"))));

            chart.select('.axis.x')
                .call(d3.axisBottom(x));
            chart.select('.axis.y')
                .call(d3.axisLeft(y));

            chart.select('.label.y')
                .text(state.features.selected.size === 1 ?
                    this.locales.retrieve(this.localization.descriptions,
                        state.features.selected.first()
                    ) :
                    this.locales.message("features-header")
                );

            const line = d3.line()
                .defined(g => g !== undefined && g !== null)
                .x((g, i) => x(d.sprints[i][state.sprint_meta.extra[0]]))
                .y(g => y(g))
                .curve(d3.curveMonotoneX);

            d3.select(nodes[i])
                .selectAll("g.feature")
                .each((f, j, features) => {
                    const points = d3.select(features[j]).selectAll("circle")
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
                        .attr("cx", (g, i) => x(d.sprints[i][state.sprint_meta.extra[0]]))
                        .attr("cy", g => y(g))
                        .attr("fill-opacity", 0)
                        .transition()
                        .duration(1000)
                        .attr("fill-opacity", 1);
                });

            d3.select(nodes[i])
                .selectAll("g.feature path")
                .attr("stroke", (d, i) => scheme[i % scheme.length])
                .attr("d", d => line(d.sprints))
                .transition()
                .duration(1000)
                .attrTween("stroke-dasharray", function() {
                    const length = this.getTotalLength();
                    return d3.interpolateString(`0,${length}`, `${length},${length}`);
                });
        });
    }
}

export default { Table, LineChart };
