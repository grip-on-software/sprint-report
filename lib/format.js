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
                    "sprints": _.reverse(requestsToSprints(_.initial(project[1]),
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
        const table = d3.select('#content table');
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
    format(data, state) {
    }
}

export default { Table, LineChart };
