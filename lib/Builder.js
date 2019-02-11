import _ from 'lodash';
import * as d3 from 'd3';
import {OrderedSet} from 'immutable';
import {Navigation} from '@gros/visualization-ui';
import config from 'config.json';
import format from './format';
import exports from './export';
import SourceAge from './SourceAge';

const setToggle = function(set, value, extra=null) {
    if (set.has(value)) {
        if (extra !== null && set.isSuperset(extra)) {
            set = set.subtract(extra);
        }
        return set.delete(value);
    }
    set = set.add(value);
    if (extra !== null) {
        set = set.union(extra);
    }
    return set;
};

const findTabs = (container) => {
    const view = d3.mouse(document.body);
    const viewX = view[0] - (document.documentElement.scrollLeft || document.body.scrollLeft);
    const viewY = view[1] - (document.documentElement.scrollTop || document.body.scrollTop);
    if (typeof document.elementsFromPoint === "function") {
        return d3.selectAll(document.elementsFromPoint(viewX, viewY))
            .filter('a:not(.dragging), label:not(.dragging)');
    }
    return d3.select(container).selectAll('a:not(.dragging), label:not(.dragging)').filter(function() {
        const rect = this.getBoundingClientRect();
        return rect.left <= viewX && viewY <= rect.left + rect.width &&
            rect.top <= viewY && viewY <= rect.top + rect.height;
    });
};

const updateOrderTags = (element, items, key) => {
    const order = _.zipObject(Array.from(items.selected),
        _.range(1, items.selected.size + 1)
    );
    element.selectAll('span.tag')
        .classed('is-hidden', d => !order[key(d)])
        .text(d => order[key(d)] || null);
};

class Builder {
    constructor(projects, features, expressions, locales, localization, sprints) {
        this.projects = {
            known: _.map(projects, "name"),
            meta: _.map(projects,
                project => _.assign({}, project, {accessible: true})
            ),
            teams: OrderedSet(_.map(_.filter(projects,
                d => _.isArray(d.project_names)), "name"
            )),
            selected: OrderedSet(),
            visible: OrderedSet()
        };
        this.projects.display_names = _.zipObject(this.projects.known,
            _.map(projects, (meta) =>
                meta.name !== meta.quality_display_name ?
                meta.quality_display_name : null
            )
        );

        this.features = _.mapValues(features, group => OrderedSet(group));
        this.features.known = Array.from(
            this.features.all.subtract(this.features.meta)
        );
        this.features.selected = this.features.default
            .subtract(this.features.meta);
        this.features.team = this.features.selected;
        this.features.project = this.features.selected;
        this.features.visible = this.features.selected;
        this.features.expressions = expressions;
        this.features.compound = OrderedSet(_.keys(expressions));
        this.features.attributes = OrderedSet(_.flatten(_.map(expressions,
            expression => expression.attributes
        )));
        this.features.format = {
            assignment: (feature, locale, values) => this.getAssignment(feature,
                locale, values
            )
        };

        this.locales = locales;
        this.localization = localization;

        this.formatter = {
            selected: format.known[0].name,
            current: null,
            known: format.known
        };
        this.formatter.classes = _.fromPairs(_.map(this.formatter.known,
            (formatter) => [formatter.name, format[formatter.class]]
        ));

        this.exporter = {
            known: _.filter(exports.known,
                exporter => !exporter.config || config[exporter.config] !== ""
            )
        };
        this.exporter.classes = _.fromPairs(_.map(this.exporter.known,
            (exporter) => [exporter.name, exports[exporter.class]]
        ));

        this.sprints = _.assign({}, sprints, {
            first: 0,
            current: sprints.limit,
            oldest: 0,
            closedOnly: false
        });

        this.sprint_meta = {
            known: ['sprint_name', 'sprint_num', 'start_date', 'close_date'],
            selected: OrderedSet(['sprint_name', 'sprint_num', 'close_date']),
            numeric: OrderedSet(['sprint_num']),
            changed: false,
            format: {
                sprint_name: (d, node) => this.formatSprintName(d, node),
                sprint_num: (d) => this.locales.message('sprint-number', [d]),
                start_date: (d, node) => this.formatDate(d, node, "start_date"),
                close_date: (d, node) => this.formatDate(d, node, "close_date")
            }
        };

        this.navigationHooks = {
            feature: (keys) => this.updateFeatures(keys),
            format: (formatter) => this.updateFormat(formatter[0]),
            count: (num) => {
                if (!this.sprints.old) {
                    this.sprints.first = 0;
                    this.sprints.current = Math.min(this.sprints.limit, num[0]);
                }
                else if (num.length === 1) {
                    this.sprints.first = 0;
                    this.sprints.current = Number(num[0]);
                }
                else {
                    this.sprints.first = Number(num[0]);
                    this.sprints.current = Number(num[1]);
                }
            },
            closed: (closed) => {
                this.sprints.closedOnly = closed[0] === '1';
            },
            meta: (meta) => {
                const sprint_meta = OrderedSet(_.intersection(meta,
                    this.sprint_meta.known
                ));
                if (!sprint_meta.equals(this.sprint_meta.selected)) {
                    this.sprint_meta.selected = sprint_meta;
                    this.sprint_meta.changed = true;
                }
            },
            config: (visible) => {
                const hidden = d3.select('#config').classed('is-hidden');
                if (hidden !== (visible[0] === '0')) {
                    d3.select('#options a[data-toggle=config]')
                        .dispatch("click");
                }
            }
        };

        this.configToggles = {
            sources: d => {
                const projects = Array.from(this.projects.selected);
                const sources = new SourceAge(this.locales, this.localization);
                sources.build(projects);
            }
        };
    }

    formatSprintName(data, node, key) {
        if (_.isArray(data)) {
            if (node.classed('meta')) {
                node.selectAll('tspan')
                    .data(data)
                    .enter()
                    .append('tspan')
                    .classed('has-source', true)
                    .text(d => d)
                    .filter(':not(:last-child)').each(function() {
                        this.insertAdjacentText('afterend', ', ');
                    });
                return null;
            }
            else {
                return _.join(data, ', ');
            }
        }
        return data;
    }

    formatDate(data, node, key) {
        const date = this.localization.moment(data,
            ["YYYY-MM-DD HH:mm:ss", "YYYY-MM-DD"], true
        );
        const description = this.locales.attribute("sprint_meta", key);
        const title = this.locales.message("date-title",
            [description, date.format()]
        );
        if (node.classed('meta')) {
            node.append('title').text(title);
        }
        else if (!node.classed('title')) {
            node.attr('title', title);
        }

        return date.format('ll');
    }

    getUrl(selections) {
        const parts = _.assign({}, {
            project: this.projects.selected,
            feature: this.features.selected,
            meta: this.sprint_meta.selected,
            format: [this.formatter.selected],
            count: [this.sprints.first, this.sprints.current],
            closed: [this.sprints.closedOnly ? '1' : '0']
        }, selections);

        const formatPart = (key, values) => `${key}_${values.join(',')}`;
        var accumulator = [formatPart("project", parts.project)];
        return `#${_.transform(parts, (accumulator, values, key) => {
            if (key === "feature" && values.selected) {
                values = _.map(Array.from(values.selected), feature => {
                    const option = _.find([
                        ['team', 'project'], ['project', 'team']
                    ], options => values[options[0]].includes(feature) &&
                        !values[options[1]].includes(feature)
                    );
                    return option ? `${option[0]}~${feature}` : feature;
                });
            }
            if (key !== "project") {
                accumulator.push(formatPart(key, values));
            }
        }, accumulator).join('!')}`;
    }

    updateFeatures(keys) {
        const features = _.intersection(_.map(keys, feature =>
            feature.includes("~") ? feature.split("~", 2)[1] : feature
        ), this.features.known);
        if (this.features.visible.equals(this.features.selected)) {
            this.features.visible = OrderedSet(features);
        }
        else {
            const added = _.difference(features,
                Array.from(this.features.selected)
            );
            const removed = this.features.selected.subtract(features);
            this.features.visible = this.features.visible
                .withMutations((visible) => {
                    visible.union(added).subtract(removed);
                });
        }
        this.features.selected = OrderedSet(features);
        this.features.team = OrderedSet(_.intersection(_.map(keys,
            feature => feature.startsWith("team~") ?
                feature.split("~", 2)[1] : feature
        ), this.features.known));
        this.features.project = OrderedSet(_.intersection(_.map(keys,
            feature => feature.startsWith("project~") ?
                feature.split("~", 2)[1] : feature
        ), this.features.known));
    }

    updateFormat(formatter) {
        if (formatter !== this.formatter.selected &&
            _.some(this.formatter.known, format => format.name === formatter)) {
            this.formatter.selected = formatter;
            this.formatter.current = null;
        }
    }

    makeConfiguration(spinner) {
        this.makeToggle();
        // Project navigation handles current item selection which builds the
        // remaining selections in the configuration.
        this.makeProjectNavigation(spinner);
        this.makeExportOptions();
    }

    setTitle() {
        const projects = Array.from(this.projects.selected).join(", ");
        const title = d3.select("#title");
        title.select("span.projects").text(projects !== "" ?
            this.locales.message("title-projects", [projects]) : ""
        );
    }

    makeToggle() {
        d3.selectAll('#options .toggle')
            .classed('tooltip', true)
            .datum(function() {
                return this.dataset;
            })
            .attr('data-tooltip', d => {
                const hidden = d3.select(`#${d.toggle}`).classed('is-hidden');
                return this.locales.message(`${d.toggle}-${hidden ? "show" : "hide"}`);
            })
            .on('click', (d, i, nodes) => {
                const config = d3.select(`#${d.toggle}`);
                const hidden = config.classed('is-hidden');
                const column = d3.select(nodes[i].parentNode.parentNode.parentNode);

                if (hidden && this.configToggles[d.toggle]) {
                    this.configToggles[d.toggle](d);
                }
                column.classed('is-narrow', false).classed('is-11', true);
                config.classed('is-hidden', false)
                    .style('opacity', hidden ? 0 : 1)
                    .transition()
                    .style('opacity', hidden ? 1 : 0)
                    .on("end", function() {
                        d3.select(this).classed('is-hidden', !hidden);
                        column.classed('is-narrow', !hidden)
                            .classed('is-11', hidden);
                    });
                d3.select(nodes[i])
                    .attr('data-tooltip', this.locales.message(`${d.toggle}-${hidden ? "hide" : "show"}`))
                    .select('i')
                    .classed(d.shown, hidden)
                    .classed(d.hidden, !hidden);
            });
    }

    updateToggle() {
        const options = d3.select('#options');
        options.selectAll('.toggle').each((d, i, nodes) => {
            const config = d3.select(`#${d.toggle}`);
            const hidden = config.classed('is-hidden');
            if (!hidden && this.configToggles[d.toggle]) {
            this.configToggles[d.toggle](d);
            }
        });
        options.classed("is-hidden", false);
    }

    setAccessible(projects, spinner) {
        projects = OrderedSet(projects);
        if (projects.has('*')) {
            return;
        }
        this.projects.meta = _.map(this.projects.meta, project => {
            project.accessible = _.isArray(project.project_names) ?
                !projects.intersect(project.project_names).isEmpty() :
                projects.has(project.project_names);
            return project;
        });
        this.updateProjectNavigation("update");
    }

    buildProjectFilter(projectNavigation, selections) {
        const isRecent = _.every(this.projects.meta,
            (project) => this.projects.selected.has(project.name) ?
                project.recent : true
        );
        const teamProjects = new Set(_.flatten(_.map(this.projects.meta,
            project => this.projects.selected.has(project.name) &&
                _.isArray(project.project_names) ? project.project_names : []
        )));
        const isTeam = _.every(this.projects.meta,
            (project) => teamProjects.has(project.name) || project.team ||
                !this.projects.selected.has(project.name)
        );
        const isAccessible = _.every(this.projects.meta,
            (project) => this.projects.selected.has(project.name) ?
                project.accessible : true
        );
        const isSupport = _.every(this.projects.meta, project => !project.core);
        const filter = (projects) => {
            const filters = [];
            d3.selectAll('#project-filter input').each(function(d) {
                const checked = d3.select(this).property('checked');
                if ((d.inverse && !checked) || (!d.inverse && checked)) {
                    filters.push(d.inverse ? d.inverse : d.key);
                }
            });

            return _.filter(projects,
                project => _.every(filters, filter => !!project[filter])
            );
        };

        const projectFilter = () => _.concat(selections,
            filter(this.projects.meta)
        );

        const label = d3.select('#project-filter')
            .selectAll('label')
            .data([
                {key: 'recent', default: !!isRecent},
                {key: 'support', inverse: 'core', default: !!isSupport},
                {key: 'team', default: !!isTeam},
                {key: 'accessible', default: !!isAccessible}
            ])
            .enter()
            .append('label')
            .classed('checkbox tooltip', true)
            .attr('data-tooltip', d => this.locales.attribute("project-filter-title", d.key));
        label.append('input')
            .attr('type', 'checkbox')
            .property('checked', d => d.default)
            .on('change', () => projectNavigation.update(projectFilter()));
        label.append('span')
            .text(d => this.locales.attribute("project-filter", d.key));

        return projectFilter;
    }

    includeTeamProjects(updateList, d) {
        if (!_.isArray(d.project_names)) {
            return false;
        }
        const listNames = _.map(updateList.data(), p => p.name);
        const shown = _.intersection(listNames, d.project_names);
        return _.isEmpty(shown) || (shown.length === 1 && shown[0] === d.name);
    }

    setCurrentItem(project) {
        const knownProjects = new Set(this.projects.known);
        const parts = project.split(/[!|]/);

        _.forEach(parts, (value, index) => {
            if (index === 0) {
                this.projects.selected = OrderedSet(value.split(','))
                    .intersect(knownProjects);
                this.projects.visible = this.projects.selected;
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
    }

    isProjectActive(key) {
        return this.projects.selected.includes(key);
    }

    getProjectTooltip(d, updateList) {
        if (d.title) {
            return d.title;
        }
        var prefix = "project";
        if (_.isArray(d.project_names)) {
            prefix += "-team";
            if (!this.includeTeamProjects(updateList, d)) {
                prefix += "-only";
            }
        }
        else if (d.component) {
            prefix += "-component";
        }
        const msg = `${prefix}-title-${this.isProjectActive(d.name) ? "remove" : "add"}`;
        return this.locales.message(msg, [d.quality_display_name]);
    }

    updateProjectNavigation(method) {
        if (this.projectNavigation === null) {
            return;
        }
        const projectFilter = this.buildProjectFilter(this.projectNavigation, [
            {
                name: "*",
                display_name: null,
                message: this.locales.message("projects-select-all"),
                title: this.locales.message("projects-select-all-title"),
                projects: (list) => OrderedSet(_.map(
                    _.filter(list.data(), project => !project.projects),
                    project => project.name
                )),
                classes: "has-text-link"
            },
            {
                name: "",
                display_name: null,
                message: this.locales.message("projects-deselect"),
                title: this.locales.message("projects-deselect-title"),
                projects: () => OrderedSet(),
                classes: "has-text-danger"
            }
        ]);
        this.projectNavigation[method](projectFilter());
    }

    makeProjectNavigation(spinner) {
        // Create project navigation
        const updateProjects = (element, list) => {
            const updateList = list.merge(list.enter());
            element.each((d, i, nodes) => {
                d3.select(nodes[i].parentNode)
                    .classed('is-active', d => this.isProjectActive(d.name));
            });
            element.attr('class', d => `tooltip is-tooltip-multiline is-tooltip-center ${d.classes || ""}`)
                .attr('data-tooltip', d => this.getProjectTooltip(d, updateList))
                .attr('href', d => {
                    var projects = null;
                    if (d.projects) {
                        projects = d.projects(updateList);
                    }
                    else {
                        projects = setToggle(OrderedSet(this.projects.selected),
                            d.name, this.includeTeamProjects(updateList, d) ?
                            d.project_names : null
                        );
                    }
                    return this.getUrl({project: projects});
                });
            element.select('span.project').text(d => d.message || d.name);
            updateOrderTags(element, this.projects, d => d.name);
        };
        const updateSelection = () => {
            const list = d3.selectAll('#navigation ul li');
            list.selectAll('a')
                .call(updateProjects, list);
            // Update based on selection changes
            this.updateToggle();
            this.makeSprintSelection();
            this.makeFeatureSelection();
            this.makeFormatSelection();
            this.makeFormat(spinner);
        };
        this.projectNavigation = new Navigation({
            container: '#navigation',
            prefix: 'project_',
            key: d => d.name,
            isActive: key => this.isProjectActive(key),
            setCurrentItem: (project, hasProject) => {
                this.setCurrentItem(project);
                updateSelection();
                return true;
            },
            addElement: (element) => {
                element.append('span').classed('project', true);
                element.append('span').classed('tag', true);

                updateProjects(element, d3.selectAll('#navigation ul li'));
                element.style("width", "0%")
                    .style("opacity", "0")
                    .transition()
                    .style("width", "100%")
                    .style("opacity", "1");

                this.addDrag(element, {
                    name: "project",
                    items: this.projects,
                    key: d => d.name
                });
            },
            updateElement: (element) => {
                updateProjects(element.selectAll('a'), element);
            },
            removeElement: (element) => {
                element.transition()
                    .style("opacity", "0")
                    .remove();
            }
        });

        // Select projects to let the filter know if we selected a project that
        // would be filtered by default.
        const prefix = '#project_';
        if (window.location.hash.startsWith(prefix)) {
            this.setCurrentItem(window.location.hash.slice(prefix.length));
        }
        this.updateProjectNavigation("start");
    }

    addDrag(element, config) {
        config = _.assign({}, {
            name: "project",
            items: {selected: OrderedSet()},
            key: d => d,
            relative: false
        }, config);
        if (element.empty()) {
            return;
        }
        element.call(d3.drag()
            // Consider a slight movement to still be a (de)selection
            .clickDistance(0.2 * _.mean(_.map(element.nodes(),
                node => node.getBoundingClientRect().width
            )))
            .filter(d => config.items.selected.has(config.key(d)))
            .subject(() => {return {x: d3.event.x, y: d3.event.y};})
            .on("start", (d, i, nodes) => {
                d3.select(nodes[i]).classed("drag", true);
                const initial = d3.mouse(config.relative ? config.relative :
                    nodes[i]
                );
                d3.event.on("drag", (d, i, nodes) => {
                    d3.select(nodes[i])
                        .classed("dragging", true)
                        .style("left", `${d3.event.x - initial[0]}px`)
                        .style("top", `${d3.event.y - initial[1]}px`);
                })
                .on("end", (d, i, nodes) => {
                    const dropTab = d3.select(findTabs(nodes[i].parentNode.parentNode).node());
                    const dragged = d3.select(nodes[i]);
                    dragged.transition()
                        .duration(200)
                        .ease(d3.easeLinear)
                        .style("left", "0px")
                        .style("top", "0px")
                        .on("end", () => {
                            dragged.classed("drag dragging", false);
                        });
                    if (dropTab.empty()) {
                        return;
                    }
                    const drag = config.key(d);
                    const drop = config.key(dropTab.datum());
                    if (!config.items.selected.has(drag) ||
                        !config.items.selected.has(drop)
                    ) {
                        return;
                    }
                    const swap = _.fromPairs([[drag, drop], [drop, drag]]);
                    document.location = this.getUrl(_.fromPairs([[config.name,
                        _.map(Array.from(config.items.selected),
                            name => swap[name] || name
                        )
                    ]]));
                });
            })
        );
    }

    makeSprintSelection() {
        const max = _.maxBy(_.filter(this.projects.meta,
            p => this.projects.selected.includes(p.name)
        ), p => p.num_sprints) || {num_sprints: this.sprints.limit};
        this.sprints.current = Math.min(this.sprints.current, max.num_sprints);
        this.sprints.first = Math.min(this.sprints.first, this.sprints.current);

        const count = d3.select('#sprints-count')
            .attr("data-tooltip", this.locales.message(
                `sprints-count-tooltip${this.sprints.first === 0 ? "-recent" : ""}`,
                [this.sprints.current - this.sprints.first, this.sprints.current]
            ))
            .select('svg');
        const width = count.attr("width") - 32;
        const height = count.attr("height") - 16;

        const x = d3.scaleLinear()
            .domain([0, max.num_sprints])
            .rangeRound([0, width]);

        var ticks = x.ticks(Math.min(max.num_sprints, 10));
        ticks[ticks.length - 1] = max.num_sprints;
        const axis = d3.axisBottom(x)
            .tickValues(ticks)
            .tickFormat(d3.format("d"));

        const svg = count.select('g')
            .attr('transform', 'translate(16, 0)');
        svg.select('g.axis')
            .attr("transform", `translate(0, ${height})`)
            .call(axis);

        const brush = d3.brushX()
            .extent([[0, 0], [width, height + 16]])
            .on("end", () => {
                if (!d3.event.sourceEvent || !d3.event.selection) {
                    return;
                }
                const pos = d3.event.selection.map(x.invert).map(Math.round);
                window.location = this.getUrl({
                    count: pos
                });
            });

        svg.select('g.brush')
            .call(brush)
            .call(brush.move, [x(this.sprints.first), x(this.sprints.current)]);

        const onlyClosed = this.sprints.closed ? true : null;
        const closed = d3.select('#sprints-closed')
            .attr('disabled', onlyClosed)
            .select('input')
            .attr('disabled', onlyClosed)
            .attr('checked', onlyClosed || this.sprints.closedOnly ? true : null)
            .on('change.close', () => {
                window.location = this.getUrl({
                    closed: [closed.property('checked') ? '1' : '0']
                });
            });

        const meta = d3.select('#sprints-meta ul').selectAll('li')
            .data(this.sprint_meta.known);
        const newMeta = meta.enter().append('li');
        const label = newMeta.append('a')
            .classed('tooltip is-tooltip-multiline is-tooltip-center', true);
        label.append('span')
            .classed('meta', true)
            .text(d => this.locales.attribute("sprint_meta", d));
        label.append('span').classed('tag', true);
        this.addDrag(label, {
            name: "meta",
            items: this.sprint_meta,
            key: d => d
        });

        const updateMeta = newMeta.merge(meta)
            .classed('is-active', d => this.sprint_meta.selected.has(d));
        updateMeta.selectAll('a')
            .attr("data-tooltip", d => this.locales.message(`sprint-meta-${this.sprint_meta.selected.has(d) ? "deselect" : "select"}`,
                [this.locales.attribute("sprint-meta-tooltip", d)]
            ))
            .attr('href', d => this.getUrl({
                meta: setToggle(this.sprint_meta.selected, d)
            }));
        updateMeta.selectAll('input')
            .property('checked', d => this.sprint_meta.selected.has(d));

        updateOrderTags(updateMeta, this.sprint_meta, d => d);
    }

    makeFeatureSelection() {
        this.makeFeatureCategories();
        this.makeSelectedFeatures();
    }

    setFeatureTooltip(d, link) {
        var description = this.locales.retrieve(this.localization.long_descriptions,
            d, ""
        );
        const assignment = this.getAssignment(d);
        if (assignment !== null && !_.includes(assignment, "(")) {
            description = description !== "" ?
                this.locales.message("features-tooltip-assignment", [
                    description, assignment
                ]) : assignment;
        }
        link.attr('data-tooltip', description)
            .classed('tooltip is-tooltip-multiline is-tooltip-center',
                description !== ""
            );
    }

    makeFeatureCategories() {
        const categories = d3.select('#features').selectAll('.columns')
            .data(_.filter(this.localization.categories,
                d => !_.isEmpty(d.items)
            ));

        const newCategories = categories.enter()
            .append('div').classed('columns', true);
        const name = newCategories.append('div')
            .classed('column category tooltip', true);
        name.attr("data-tooltip",
            d => this.locales.message("features-category-hide",
                [this.locales.retrieve(d)]
            )
        );
        name.on("click", (d, i, nodes) => {
            const tabs = d3.select(nodes[i].parentNode).select('.tabs');
            const hidden = tabs.classed("is-hidden");
            tabs.classed("is-hidden", false).style("height", null);
            const height = tabs.node().clientHeight;
            tabs.style("opacity", hidden ? 0 : 1)
                .style("height", hidden ? '0px' : `${height}px`)
                .transition()
                .style("opacity", hidden ? 1 : 0)
                .style("height", hidden ? `${height}px` : '0px')
                .on("end", () => {
                    tabs.classed("is-hidden", !hidden);
                    d3.select(nodes[i]).classed("is-size-7", !hidden)
                        .attr("data-tooltip", this.locales.message(`features-category-${hidden ? "hide" : "show"}`,
                            [this.locales.retrieve(d)]
                        ))
                        .select(".icon").classed("is-small", !hidden);
                });
        });
        name.append('span')
            .classed('icon', true)
            .append('i')
            .attr('class', d => d.icon.join(' '));
        name.append('span')
            .classed('name', true)
            .text(d => this.locales.retrieve(d));

        newCategories.append('div')
            .classed('column features', true)
            .append('div')
            .classed('tabs is-toggle is-size-7', true)
            .append('ul');

        const formatFeatures = _.find(this.formatter.known,
            {name: this.formatter.selected}
        ).features;
        const updateCategories = newCategories.merge(categories);
        const tabs = updateCategories.selectAll('.features .tabs ul');
        const features = tabs.selectAll('li.item')
            .data(d => d.items);

        const newFeatures = features.enter()
            .append('li')
            .classed('item', true);
        const label = newFeatures.append('a');
        label.each(
            (d, i, nodes) => this.setFeatureTooltip(d, d3.select(nodes[i]))
        );
        label.append('span')
            .classed('feature', true)
            .text(d => this.locales.retrieve(this.localization.descriptions, d));
        label.append('span').classed('tag', true);
        label.append('span')
            .classed('icon is-small is-hidden', true)
            .append('i');
        this.addDrag(label, {
            name: "feature",
            items: this.features,
            key: d => d
        });

        const updateFeatures = newFeatures.merge(features)
            .classed('is-hidden', d => !this.features.selected.has(d) &&
                !_.some(formatFeatures, group => group.startsWith('!') ?
                    !this.features[group.slice(1)].has(d) :
                    this.features[group].has(d)
                )
            )
            .classed('is-active', d => this.features.selected.has(d));
        updateFeatures.filter(':not(.is-hidden)')
            .classed('is-first', (d, i) => i === 0)
            .classed('is-last', (d, i, nodes) => i === nodes.length - 1);
        updateFeatures.selectAll('a')
            .attr('href', d => this.getUrl({
                feature: setToggle(this.features.selected, d)
            }));
        updateFeatures.selectAll('.icon i')
            .attr('class', (d, i, nodes) => {
                const team = this.features.team.has(d);
                const project = this.features.project.has(d);
                var classes = null;
                var tooltip = null;
                if (team && !project) {
                    classes = 'fas fa-users';
                    tooltip = 'features-team';
                }
                if (project && !team) {
                    classes = 'fas fa-sitemap';
                    tooltip = 'features-project';
                }
                d3.select(nodes[i].parentNode)
                    .classed('is-hidden', classes === null);
                return classes;
            });

        updateOrderTags(updateFeatures, this.features, d => d);

        const more = tabs.selectAll('li.more')
            .data(d => [{
                category: d,
                message: 'more'
            }]);
        const newMore = more.enter()
            .append('li')
            .classed('more', true);
        newMore.append('button')
            .classed('button is-text is-size-7 tooltip', true)
            .text(d => this.locales.message(`features-${d.message}`))
            .attr('data-tooltip',
                d => this.locales.message(`features-${d.message}-tooltip`,
                    [this.locales.retrieve(d.category)]
                )
            )
            .on('click', (d, i, nodes) => {
                d3.select(nodes[i].parentNode.parentNode)
                    .selectAll('li.item')
                    .classed('is-hidden', false)
                    .classed('is-first', (d, i) => i === 0)
                    .classed('is-last', (d, i, nodes) => i === nodes.length - 1);
                d3.select(nodes[i].parentNode).classed('is-hidden', true);
            });
        newMore.merge(more).classed('is-hidden',
            (d, i, nodes) => d3.select(nodes[i].parentNode.parentNode)
                .select('li.item.is-hidden').empty()
        );
    }

    toggleFeatureSelection(selection, panel) {
        const t = d3.transition().duration(500);
        const hidden = selection.classed('is-hidden');
        if (hidden) {
            d3.select('#features .columns .selection').remove();
            selection.classed('is-hidden', false);
        }
        selection.selectAll('.panel-block, .tabs')
            .classed('is-hidden', false)
            .style('opacity', hidden ? 0 : 1)
            .transition(t)
            .style('opacity', hidden ? 1 : 0);
        selection.transition(t).on('end', () => {
            panel.select('.panel-icon i')
                .attr('class', `far fa-${hidden ? "minus" : "plus"}-square`);
            selection.selectAll('.panel-block, .tabs')
                .classed('is-hidden', !hidden);
            if (!hidden) {
                d3.select('#features .columns')
                    .append('div')
                    .classed('column selection is-narrow', true)
                    .append(() => panel.node().cloneNode(true))
                    .select('.panel-icon')
                    .on('click', () => this.toggleFeatureSelection(selection, panel));
            }
            selection.classed('is-hidden', !hidden);
        });
    }

    makeSelectedFeatures() {
        const selection = d3.select('#feature-selection');
        const panel = selection.select('.panel');
        panel.select('.panel-icon')
            .on('click', () => this.toggleFeatureSelection(selection, panel));
        const selectedFeatures = panel.selectAll('.panel-block')
            .data(Array.from(this.features.selected));
        selectedFeatures.exit().remove();
        const newSelection = selectedFeatures.enter()
            .append('label')
            .classed('panel-block', true);
        newSelection.append('span')
            .classed('order panel-icon', true);
        newSelection.append('span')
            .classed('feature', true);
        this.addDrag(newSelection, {
            name: "feature",
            items: this.features,
            key: d => d,
            relative: panel.node()
        });
        const updateSelection = newSelection.merge(selectedFeatures).order();
        updateSelection.select('.order')
            .text((d, i) => `${i + 1}.`);
        updateSelection.select('.feature')
            .text(d => this.locales.retrieve(this.localization.descriptions, d))
            .each(
                (d, i, nodes) => this.setFeatureTooltip(d, d3.select(nodes[i]))
            );
        const icons = updateSelection.selectAll('.icon')
            .data((d, i) => [
                {
                    type: 'visibility',
                    options: ['visible', 'team', 'project', 'hidden'],
                    option: _.find([
                        ['team', 'project'], ['project', 'team'], ['visible'], ['all']
                    ], option => this.features[option[0]].includes(d) &&
                        (option.length === 1 || !this.features[option[1]].includes(d))
                    )[0],
                    name: d,
                    update: {
                        visible: features => _.assign(features, {
                            visible: features.visible.add(d)
                        }),
                        team: features => _.assign(features, {
                            project: features.project.remove(d),
                            team: features.team.add(d)
                        }),
                        project: features => _.assign(features, {
                            team: features.team.remove(d),
                            project: features.project.add(d)
                        }),
                        hidden: features => _.assign(features, {
                            visible: features.visible.remove(d)
                        })
                    },
                    icons: {
                        visible: 'fas fa-eye',
                        team: 'fas fa-users',
                        project: 'fas fa-sitemap',
                        hidden: 'fas fa-eye-slash'
                    }
                },
                {
                    type: 'up',
                    swap: i - 1,
                    name: d,
                    icon: 'fas fa-arrow-up'
                },
                {
                    type: 'down',
                    swap: i + 1,
                    name: d,
                    icon: 'fas fa-arrow-down'
                }
            ]);
        icons.exit().remove();
        const newIcon = icons.enter().append('a')
            .classed('icon panel-icon tooltip', true);
        newIcon.append('i');
        newIcon.merge(icons)
            .attr('data-tooltip',
                d => this.locales.attribute('feature-selection-tooltip',
                    d.options ? `${d.type}-${d.option}` : d.type
                )
            )
            .attr('href', (d, i) => {
                var features = {
                    selected: this.features.selected,
                    team: this.features.team,
                    project: this.features.project,
                    visible: this.features.visible
                };
                if (d.options) {
                    const current = d.option;
                    const next = d.options[(_.findIndex(d.options,
                        option => option === d.option) + 1
                    ) % d.options.length];
                    features[current] = features[current].delete(d.name);
                    features = d.update[next](features);
                }
                else {
                    const selected = Array.from(features.selected);
                    if (d.swap < 0 || d.swap >= selected.length) {
                        return null;
                    }
                    const other = selected[d.swap];
                    const swap = _.fromPairs([[d.name, other], [other, d.name]]);
                    features.selected = OrderedSet(_.map(selected,
                        name => swap[name] || name
                    ));
                }
                return this.getUrl({
                    feature: features
                });
            })
            .classed('is-disabled', d => !d.options &&
                (d.swap < 0 || d.swap >= this.features.selected.size)
            )
            .on('mousedown touchstart', () => {
                d3.event.stopPropagation();
            })
            .select('i')
            .attr('class', d => {
                if (d.options) {
                    return d.icons[d.option];
                }
                return d.icon;
            });

        const selectionButtons = selection.select('.tabs ul')
            .selectAll('li')
            .data([
                {
                    features: () => this.features.default
                        .subtract(this.features.meta),
                    message: 'reset',
                    classes: 'has-text-warning tooltip'
                },
                {
                    features: () => OrderedSet(),
                    message: 'clear',
                    classes: 'has-text-danger tooltip'
                }
            ]);
        selectionButtons.enter()
            .append('li')
            .append('a')
            .attr('class', d => d.classes)
            .attr('data-tooltip', d => this.locales.message(`features-select-${d.message}-tooltip`))
            .text(d => this.locales.message(`features-select-${d.message}`))
            .merge(selection.selectAll('.tabs ul a'))
            .attr('href', d => this.getUrl({
                    feature: d.features(this.features)
                })
            );
    }

    getAssignment(feature, locales=["descriptions"], values=null) {
        const assignment = this.features.expressions[feature];
        if (!assignment || !assignment.expression) {
            return null;
        }

        if (assignment.attributes) {
            return _.replace(assignment.expression,
                new RegExp(`(^|\\W)(${_.join(assignment.attributes, '|')})(\\W|$)`, "g"),
                (m, p1, attribute, p2) => {
                    var unit = _.transform(locales, (accumulator, key) => {
                        const locale = this.localization[key];
                        const text = this.locales.retrieve(locale,
                            attribute, null
                        );
                        if (text !== null) {
                            accumulator.text = text;
                            return false;
                        }
                        return null;
                    }, {text: "%s"});
                    if (values !== null) {
                        unit.text = vsprintf(unit.text, [values[attribute]]);
                    }
                    return `${p1 || ""}${unit.text}${p2 || ""}`;
                }
            );
        }
        return assignment.expression;
    }

    makeFormatSelection() {
        const formats = d3.select('#format ul').selectAll('li')
            .data(this.formatter.known);
        const newFormats = formats.enter()
            .append('li')
            .attr('id', d => `format-${d.name}`);
        const label = newFormats.append('a');
        label.append('span')
            .classed('icon', true)
            .append('i')
            .attr('class', d => d.icon.join(' '));
        label.append('span')
            .text(d => this.locales.attribute("formats", d.name));

        newFormats.merge(formats)
            .classed('is-active', d => d.name === this.formatter.selected)
            .selectAll('a')
            .attr('href', d => this.getUrl({
                format: [d.name]
            }));
    }

    makeFormat(spinner) {
        if (this.formatter.current === null) {
            this.formatter.current = new this.formatter.classes[this.formatter.selected](this.locales, this.localization);
        }
        this.formatter.current.build({
            projects: this.projects,
            features: this.features,
            sprints: this.sprints,
            sprint_meta: this.sprint_meta
        }, spinner).then(() => this.setTitle());
    }

    makeExportOptions() {
        const button = d3.select('#export')
            .selectAll('button')
            .data(this.exporter.known)
            .enter()
            .append('button')
            .classed('button tooltip is-tooltip-bottom', true)
            .attr('data-tooltip', d => this.locales.attribute('export_tooltip', d.name))
            .attr('id', d => `export-${d.name}`);
        button.append('span')
            .classed('icon', true)
            .append('i')
            .attr('class', d => d.icon.join(' '));
        button.append('span')
            .text(d => this.locales.attribute('exports', d.name));
        button.on('click', (d, i, nodes) => {
            const activeButton = d3.select(nodes[i])
                .classed('is-loading', true);
            const exporter = new this.exporter.classes[d.name](this.locales,
                this.localization,
                {
                    projects: this.projects,
                    features: this.features,
                    sprints: this.sprints,
                    sprint_meta: this.sprint_meta
                }
            );
            exporter.setCurrentUrl(this.getUrl(exporter.getUrlSelection()));
            exporter.build(activeButton);
        });
    }
}

export default Builder;
