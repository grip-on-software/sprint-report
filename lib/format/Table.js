import _ from 'lodash';
import * as d3 from 'd3';
import axios from 'axios';
import {Spinner} from '@gros/visualization-ui';
import config from 'config.json';
import {sprintsToFeatures} from '../data';
import Format from './Format';
import {TOOLTIP_ATTR, LABEL_ATTR} from '../attrs';

const DETAILS = 'table.details';

/**
 * Table output format
 */
export default class Table extends Format {
    initialize() {
        this.content.append('table')
            .classed('table is-bordered is-striped', true);
    }

    requestConfig(state) {
        let config = super.requestConfig(state);
        config.details = true;
        config.metrics = true;
        return config;
    }

    format(data, state, resolve) {
        const table = this.content.select('table');
        const projects = table.selectAll('tbody')
            .data(data, d => d.project_name);
        projects.exit().remove();
        const newProjects = projects.enter()
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
                .data(d => d.sprints, d => d.fixversion || d.sprint_id);
            sprintHeader.exit().remove();
            const newSprint = sprintHeader.enter()
                .append('th')
                .classed('sprint', true);

            // Sprint link and tags
            newSprint.append('span')
                .classed('links', true);
            newSprint.append('span')
                .classed('tags', true)
                .classed('has-addons', true);

            newSprint.merge(sprintHeader).each((d, i, nodes) => {
                const header = d3.select(nodes[i]);
                const sprintLinks = _.map(
                    _.zip(...[
                        _.concat([], d.sprint_name),
                        _.concat([], d.fixversion || d.sprint_id),
                        _.concat([], d.board_id)
                    ]),
                    parts => _.assign({}, d, _.zipObject(
                        ['sprint_name', 'sprint_id', 'board_id'], parts
                    ))
                );
                const links = header.select('.links')
                    .selectAll('a')
                    .data(d => config.jira_url === "" ? _.filter(sprintLinks,
                        link => this.defined(link.sprint_name)
                    ) : sprintLinks);
                links.exit().remove();
                links.enter().append('a')
                    .attr('target', '_blank')
                    .filter(':not(:last-child)').each(function() {
                        this.insertAdjacentText('afterend', ', ');
                    });

                const meta = header.select('.tags')
                    .selectAll('.tag')
                    .data(d => _.toPairs(_.pick(d,
                        Array.from(state.sprint_meta.selected.rest())
                    )));
                meta.exit().remove();
                meta.enter().append('span').classed('tag', true).merge(meta)
                    .text((d, i, nodes) => this.formatSprint(d,
                        d3.select(nodes[i]), state.sprint_meta
                    ));
            });
        });

        updateProjects.selectAll('tr.project th.name .board')
            .attr('href', d => this.getProjectUrl(state, d.project_name))
            .text(d => d.project_name);
        updateProjects.selectAll('tr.project th.name .display-name')
            .text(d => d.display_name);
        updateProjects.selectAll('tr.project th.sprint a')
            .attr('href', d => this.getSprintUrl(d))
            .classed('tooltip', d => this.getSprintUrl(d) !== null)
            .attr(TOOLTIP_ATTR, d => this.locales.message('sprint-title'))
            .text((d, i, nodes) => this.formatSprint(d, d3.select(nodes[i]),
                state.sprint_meta, "main"
            ));

        const features = updateProjects.selectAll('tr.feature')
            .data(
                d => sprintsToFeatures(d.sprints,
                    state.projects.teams.includes(d.project_name) ?
                        state.features.team : state.features.project,
                    state.features.visible, {},
                    d.metric_targets
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

        features.selectAll(DETAILS).remove();
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
                .each((v, j, sprints) => this.formatFeature(d.feature_key, v,
                    d3.select(sprints[j]), {date: d.start_date[j]}
                ));
        });

        resolve(data);
    }

    /**
     * Add or replace links to the sources of features using icons as well as
     * icons that expand or collapse the details subtables.
     */
    addSourceIcon(item, data, state) {
        item.selectAll('a.icon').remove();
        item.append('a')
            .classed('icon tooltip has-tooltip-right', true)
            .attr('href', d => data.links[d.feature_key] ?
                this.makeSprintUrl(data.links[d.feature_key].source,
                    data, data.sprints[0]
                ) : null
            )
            .attr('role', 'link')
            .attr(LABEL_ATTR, d => this.locales.message('source-label'))
            .attr(TOOLTIP_ATTR, d => this.locales.message('source-tooltip',
                [this.locales.retrieve(this.localization.descriptions, d.feature_key)]
            ))
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

        item.append('a')
            .classed('icon tooltip has-tooltip-right', true)
            .classed('is-hidden',
                d => !state.features.details.includes(d.feature_key)
            )
            .attr('role', 'link')
            .attr(LABEL_ATTR, this.locales.message('details-expand-title'))
            .attr(TOOLTIP_ATTR, this.locales.message('details-expand-title'))
            .on('click', (d, i, nodes) => {
                const sprintNode = d3.select(nodes[i].parentNode.parentNode)
                    .select('td.sprint').node();
                const icon = d3.select(nodes[i]);

                // Retrieve sprint IDs
                const sprints = _.map(data.sprints,
                    s => s.fixversion || s.sprint_id
                );

                if (state.features.default.includes(d.feature_key)) {
                    this.buildDetails(d.feature_key, icon, sprints,
                        data.details[d.feature_key], data
                    );
                }
                else {
                    const detailsSpinner = new Spinner({
                        width: sprintNode.clientWidth,
                        height: 0.8 * sprintNode.clientHeight,
                        startAngle: 220,
                        container: sprintNode,
                        id: `details-spinner-${data.project_name}-${d.feature_key}`
                    });
                    detailsSpinner.start();
                    axios.get(`data/${data.project_name}/details.${d.feature_key}.json`).then((details) => {
                        this.buildDetails(d.feature_key, icon, sprints,
                            details.data, data
                        );
                        detailsSpinner.stop();
                    }).catch(error => {
                        detailsSpinner.stop();
                        d3.select('#error-message')
                            .classed('is-hidden', false)
                            .text(this.locales.message("error-message", [error]));
                    });
                }
            })
            .append('i')
            .classed('fas fa-expand', true);
    }

    /**
     * Expand or collapse the details subtables for a feature key.
     */
    buildDetails(featureKey, icon, sprints, details, data) {
        const sprintCells = d3.select(icon.node().parentNode.parentNode)
            .selectAll('td.sprint');
        const tables = sprintCells.selectAll(DETAILS)
            .data((s, j) => {
                const sprint = this.getSprintDetails(details, sprints[j]);
                return [{
                    feature_key: featureKey,
                    rows: _.map(_.first(_.values(sprint)),
                        (v, index) => _.mapValues(sprint, z => z[index])
                    )
                }];
            });
        const expand = this.locales.message(`details-${tables.empty() ? 'collapse' : 'expand'}-title`);
        if (!tables.empty()) {
            tables.transition()
                .style("opacity", 0)
                .on("end", () => {
                    tables.remove();
                    sprintCells.node().scrollIntoView({
                        behavior: "smooth",
                        block: "center"
                    });
                });
            icon.attr(LABEL_ATTR, expand)
                .attr(TOOLTIP_ATTR, expand)
                .select('i')
                .classed('fa-expand', true)
                .classed('fa-compress', false);
            return;
        }

        const orders = _.pickBy(_.mapValues(_.first(_.values(details)),
            (v, k) => this.details[k] && this.details[k].sort ?
                {dir: 'asc', num: this.details[k].order} : null,
            _.isObject
        ));

        this.updateDetails(featureKey, sprintCells, tables, orders, data);
        sprintCells.node().scrollIntoView({
            behavior: "smooth",
            block: "center"
        });

        icon.attr(LABEL_ATTR, expand)
            .attr(TOOLTIP_ATTR, expand)
            .select('i')
            .classed('fa-expand', false)
            .classed('fa-compress', true);
    }

    /**
     * Create the details subtables for a feature key.
     */
    updateDetails(feature, sprints, tables, sortOrders, data) {
        const table = tables.enter().append('table')
            .classed('details table is-narrow has-text-weight-normal', true);

        // Create transition
        table.style("opacity", 0)
            .transition()
            .style("opacity", 1);

        // Create headers
        const header = table.append('tr').merge(tables.select('tr'))
            .selectAll('th')
            .data(t => _.sortBy(_.keys(t.rows[0]),
                k => this.details[k] ? this.details[k].order : Infinity
            ));

        const newHeader = header.enter()
            .append('th')
            .append('a');
        newHeader.append('span')
            .text(k => this.locales.attribute("details", k));
        newHeader.append('span')
            .classed('icon', true)
            .append('i');

        // Sortable headers
        newHeader.merge(header.select('a'))
            .on("click", (k) => {
                const oldNum = sortOrders[k] ? sortOrders[k].num : 1;
                const orders = _.mapValues(sortOrders, (v) => ({
                    dir: v.dir,
                    num: v.num <= oldNum ? v.num + 1 : v.num
                }));
                orders[k] = {
                    dir: sortOrders[k] && sortOrders[k].dir === 'asc' ?
                        'desc' : 'asc',
                    num: 0
                };
                const sortTables = sprints.selectAll(DETAILS)
                    .data((s, j, table) => [
                        d3.select(table[j]).selectAll(DETAILS).datum()
                    ]);
                this.updateDetails(feature, sprints, sortTables, orders, data);
            })
            .select('i')
            .attr('title', k => this.locales.message(`details-sort-${sortOrders[k] && sortOrders[k].dir === 'asc' ? 'descending' : 'ascending'}`,
                [this.locales.attribute("details-sort-tooltip", k)]
            ))
            .attr('class', k => {
                const parts = ['sort'];
                if (sortOrders[k]) {
                    if (this.details[k] && this.details[k].type) {
                        parts.push(this.details[k].type);
                        parts.push('down');
                        if (sortOrders[k].dir !== 'asc') {
                            parts.push('alt');
                        }
                    }
                    else {
                        parts.push(sortOrders[k].dir === 'asc' ? 'down' : 'up');
                    }
                }
                return `fas fa-${_.join(parts, '-')}`;
            });

        // Create detail rows
        const detail = tables.merge(table).selectAll('tr.detail')
            .data((t, i) => {
                const sortable = _.sortBy(_.keys(sortOrders),
                    k => sortOrders[k].num
                );
                const iteratees = _.flatten(_.map(sortable, k => {
                    if (!this.details[k] || !this.details[k].sort) {
                        return (row) => row[k];
                    }
                    if (this.details[k].sort.parts) {
                        return _.map(this.details[k].sort.parts,
                            (part, j) => (row) =>
                                part(row[k].split(this.details[k].sort.split,
                                    this.details[k].sort.parts.length
                                )[j])
                        );
                    }
                    return (row) => this.details[k].sort(row[k]);
                }));
                const orders = _.flatten(_.map(sortable, k => {
                    if (!this.details[k] || !this.details[k].sort ||
                        !this.details[k].sort.parts
                    ) {
                        return sortOrders[k].dir;
                    }
                    return this.details[k].sort.parts
                        .map(() => sortOrders[k].dir);
                }));
                return _.map(_.orderBy(t.rows, iteratees, orders),
                    row => _.assign({}, row, {index: i})
                );
            })
            .order();

        detail.exit().remove();
        const newDetail = detail.enter()
            .append('tr')
            .classed('detail', true);

        // Create detail cells
        const cell = detail.merge(newDetail).selectAll('td')
            .data((z, i) => _.map(_.dropRight(_.sortBy(_.toPairs(z),
                p => this.details[p[0]] ? this.details[p[0]].order : Infinity
            )), p => _.concat(p, [z.index, z.domain_name || z.key])));

        cell.exit().remove();
        cell.selectAll('*').remove();

        const newCell = cell.enter()
            .append('td');

        cell.merge(newCell).each((z, i, cells) => {
            const cell = d3.select(cells[i]);
            const details = this.details[z[0]];
            if (!details || !details.format) {
                cell.text(z[1]);
            }
            else {
                details.format(cell, z[1], feature, _.assign({}, data, {
                    source_ids: data.source_ids,
                    date: data.sprints[z[2]] ? data.sprints[z[2]].start_date : null,
                    metric_targets: data.metric_targets && data.metric_targets[feature] ?
                        data.metric_targets[feature][z[3]] : []
                }));
            }
        });
    }
}
