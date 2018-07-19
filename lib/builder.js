import _ from 'lodash';
import * as d3 from 'd3';
import axios from 'axios';
import naturalSort from 'javascript-natural-sort';
import {OrderedSet} from 'immutable';
import {vsprintf} from 'sprintf-js';
import {navigation} from '@gros/visualization-ui';
import config from 'config.json';

const requestsToSprints = function(requests, auxiliaryKeys) {
    return _.reduce(_.zipObject(auxiliaryKeys, requests),
        (result, request, key) => _.zipWith(result, request.data,
            (target, auxiliary) => _.assign({}, target, 
                (key === "" || key === "old") ?
                auxiliary : _.fromPairs([[key, auxiliary]])
            )
        ), []
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

const setToggle = function(set, value) {
    if (set.has(value)) {
        return set.delete(value);
    }
    return set.add(value);
};

class builder {
    constructor(projects, features, locales, moment, localization, sprints, spinner) {
        this.projects = {
            known: _.keys(projects).sort(naturalSort),
            display_names: _.pickBy(projects, (display_name, name) =>
                display_name !== null && name !== display_name
            ),
            selected: OrderedSet()
        };

        this.features = features;
        this.features.known = _.difference(this.features.all,
            this.features.meta
        );
        this.features.selected = OrderedSet(_.difference(this.features.default,
            this.features.meta
        ));

        this.locales = locales;
        this.moment = moment;
        this.localization = localization;

        this.sprints = _.assign({}, sprints, {
            current: sprints.limit,
            showOld: false,
            closedOnly: false
        });

        this.sprint_meta = {
            main: 'sprint_name',
            extra: ['sprint_num', 'close_date'],
            format: {
                sprint_name: (d, node) => node.text(d),
                sprint_num: (d, node) => node.text(this.locales.message('sprint-number', [d])),
                start_date: (d, node) => this.formatDate(d, node, "start_date"),
                close_date: (d, node) => this.formatDate(d, node, "close_date")
            }
        };

        this.navigationHooks = {
            feature: (features) => {
                this.features.selected = OrderedSet(_.intersection(features,
                    this.features.known
                ));
            },
            count: (num) => {
                this.sprints.current = num[0];
            },
            closed: (closed) => {
                this.sprints.closedOnly = closed[0] === '1';
            },
            old: (old) => {
                this.sprints.showOld = old[0] === '1';
            }
        };

        this.spinner = spinner;
    }

    formatDate(data, node, key) {
        const date = this.moment(data, "YYYY-MM-DD HH:mm:ss", true);
        const description = this.locales.attribute("sprint_meta", key);
        node.text(date.format('ll'))
            .attr('title', this.locales.message("date-title",
                [description, date.format()]
            ));
    }

    formatSprint(data, node, meta=null) {
        node = d3.select(node);
        if (meta === null) {
            meta = data[0];
            data = data[1];
            node.attr('title', this.locales.attribute("sprint_meta", meta));
        }
        else {
            data = data[meta];
        }
        return this.sprint_meta.format[meta](data, node);
    }

    getUrl(selections) {
        const parts = _.assign({}, {
            project: this.projects.selected,
            feature: this.features.selected,
            count: [this.sprints.current],
            closed: [this.sprints.closedOnly ? '1' : '0'],
            old: [this.sprints.showOld ? '1': '0']
        }, selections);

        const formatPart = (key, values) => `${key}_${values.join(',')}`;
        var accumulator = [formatPart("project", parts.project)];
        return `#${_.transform(parts, (accumulator, values, key) => {
            if (key !== "project") {
                accumulator.push(formatPart(key, values));
            }
        }, accumulator).join('|')}`;
    }

    makeConfiguration() {
        const hide = this.locales.message("config-hide"),
              show = this.locales.message("config-show");
        d3.select('#config-toggle')
            .attr('title', hide)
            .on('click', function() {
                const config = d3.select('#config');
                const hidden = config.classed('is-hidden');
                config.classed('is-hidden', false)
                    .style('opacity', hidden ? 0 : 1)
                    .transition()
                    .style('opacity', hidden ? 1 : 0)
                    .on("end", function() {
                        d3.select(this).classed('is-hidden', !hidden);
                    });
                d3.select(this)
                    .attr('title', hidden ? hide : show)
                    .select('i')
                    .classed('fa-cogs', hidden)
                    .classed('fa-cog', !hidden);
            });
        this.makeProjectNavigation();
        this.makeSprintSelection();
        this.makeFeatureSelection();
    }

    makeProjectNavigation() {
        // Create project navigation
        var knownProjects = new Set(this.projects.known);
        const updateProjects = (element) => {
            const _this = this;
            element.each(function() {
                d3.select(this.parentNode)
                    .classed('is-active', d => _this.projects.selected.has(d));
            });
            element.text(d => d === "" ?
                this.locales.message("projects-deselect") :
                d === "*" ? this.locales.message("projects-select-all") : d)
                .attr('href', d => {
                    return this.getUrl({project: (d === "" ? OrderedSet() :
                        d === "*" ? OrderedSet(this.projects.known) :
                        setToggle(OrderedSet(this.projects.selected), d)
                    )});
                });
        };
        const projectNavigation = new navigation({
            container: '#navigation',
            prefix: 'project_',
            setCurrentItem: (project, hasProject) => {
                const parts = project.split('|');

                _.forEach(parts, (value, index) => {
                    if (index === 0) {
                        this.projects.selected = OrderedSet(value.split(','))
                            .intersect(knownProjects);
                    }
                    else {
                        const sep = value.indexOf('_');
                        const name = value.substr(0, sep);
                        const values = value.substr(sep + 1).split(',');
                        if (this.navigationHooks[name]) {
                            this.navigationHooks[name](values);
                        }
                    }
                });
                d3.select('#navigation ul')
                    .selectAll('li a')
                    .call(updateProjects);
                this.makeSprintSelection();
                this.makeFeatureSelection();
                this.makeTable();
                return true;
            },
            addElement: (element) => {
                updateProjects(element);
            }
        });
        projectNavigation.start(_.concat("*", "", this.projects.known));
    }

    makeSprintSelection() {
        const input = d3.select('#sprints-count input')
            .attr('max', this.sprints.limit)
            .attr('value', this.sprints.current);
        const output = d3.select('#sprints-count output')
            .text(this.sprints.current);

        input.on('input.output', () => {
            output.text(input.property('value'));
            window.location = this.getUrl({
                count: [input.property('value')]
            });
        });

        const onlyClosed = this.sprints.closed ? true : null;
        const closed = d3.select('#sprints-closed label')
            .attr('disabled', onlyClosed)
            .select('input')
            .attr('disabled', onlyClosed)
            .attr('checked', onlyClosed)
            .on('change.close', () => {
                window.location = this.getUrl({
                    closed: [closed.property('checked') ? '1' : '0']
                });
            });

        const onlyRecent = this.sprints.old ? null : true;
        const old = d3.select('#sprints-old label')
            .attr('disabled', onlyRecent)
            .select('input')
            .attr('disabled', onlyRecent)
            .on('change.old', () => {
                window.location = this.getUrl({
                    count: [this.sprints.limit],
                    old: [old.property('checked') ? '1' : '0']
                });
            });
    }

    makeFeatureSelection() {
        const features = d3.select('#features ul').selectAll('li')
            .data(this.features.known);
        const newFeatures = features.enter()
            .append('li');
        const label = newFeatures.append('a');
        label.append('input')
            .attr('type', 'checkbox');
        label.append('span')
            .text(d => this.locales.retrieve(this.localization.descriptions, d));

        const updateFeatures = newFeatures.merge(features);
        updateFeatures.selectAll('a').attr('href', d => this.getUrl({
            feature: setToggle(this.features.selected, d)
        }));
        updateFeatures.selectAll('input')
            .property('checked', d => this.features.selected.has(d));
    }

    filterSprints(sprints) {
        if (this.sprints.closedOnly) {
            sprints = _.filter(sprints, d => d.sprint_is_closed);
        }
        return this.sprints.showOld ? sprints :
            _.take(sprints, this.sprints.current);
    }

    makeTable() {
        const selectedProjects = Array.from(this.projects.selected);
        const auxiliaryKeys = _.concat("", this.sprints.showOld ? "old" : [],
            _.difference(Array.from(this.features.selected),
                this.features.default
            ), "links"
        );
        this.spinner.start();
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
                    "display_name": this.projects.display_names[project[0]] || "",
                    "sprints": _.reverse(requestsToSprints(_.initial(project[1]),
                        _.initial(auxiliaryKeys))
                    ),
                    "links": _.last(project[1]).data
                };
            });

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

            const updateProjects = newProjects.merge(projects);
            const sprintHeader = updateProjects.selectAll('tr.project')
                .selectAll('th.sprint')
                .data(d => this.filterSprints(d.sprints), d => d.sprint_id);
            sprintHeader.exit().remove();
            const newSprint = sprintHeader.enter()
                .append('th')
                .classed('sprint', true);

            newSprint.append('a')
                .attr('target', '_blank');
            const sprintTags = newSprint.append('span')
                .classed('tags', true)
                .classed('has-addons', true);

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
                .each((d, i, nodes) => this.formatSprint(d, nodes[i], this.sprint_meta.main));

            const meta = sprintTags.selectAll('.tag')
                .merge(updateProjects.selectAll('tr.project th.sprint .tags .tag'))
                .data(d => _.toPairs(_.pick(d, this.sprint_meta.extra)));
            meta.exit().remove();
            meta.enter().append('span').classed('tag', true).merge(meta)
                .each((d, i, nodes) => this.formatSprint(d, nodes[i]));

            const features = updateProjects.selectAll('tr.feature')
                .data(
                    d => sprintsToFeatures(this.filterSprints(d.sprints),
                        this.features.selected
                    ),
                    d => d.feature_key
                );

            features.exit().remove();
            const newFeatures = features.enter().append('tr')
                .classed('feature', true);
            newFeatures.append('td')
                .classed('name', true)
                .text(d => this.locales.retrieve(this.localization.descriptions, d.feature_key));

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

            this.spinner.stop();
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

export default builder;
