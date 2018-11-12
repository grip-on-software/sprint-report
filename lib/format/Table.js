import _ from 'lodash';
import * as d3 from 'd3';
import {filterSprints, sprintsToFeatures} from '../data';
import Format from './Format';

export default class Table extends Format {
    initialize() {
        this.content.append('table')
            .classed('table is-bordered is-striped', true);
    }

    format(data, state, resolve) {
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
            .attr('href', d => this.getProjectUrl(d.project_name))
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
                    state.features.selected, state.features.visible
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

        resolve();
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