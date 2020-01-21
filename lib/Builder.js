import _ from 'lodash';
import * as d3 from 'd3';
import {OrderedSet} from 'immutable';
import {Navigation} from '@gros/visualization-ui';
import config from 'config.json';
import {TOOLTIP_ATTR, LABEL_ATTR} from './attrs';
import format from './format';
import exports from './export';
import {getUrl, setToggle} from './url';
import {addDrag, updateOrderTags} from './tabs';
import FeatureSelection from './FeatureSelection';
import SprintSelection from './SprintSelection';
import SourceAge from './SourceAge';

class Builder {
    constructor(projects, features, locales, localization, sprints) {
        this.projects = {
            known: _.map(projects, "name"),
            meta: _.map(projects,
                project => _.assign({}, project, {accessible: true})
            ),
            teams: OrderedSet(_.map(_.filter(projects,
                d => _.isArray(d.project_names)), "name"
            )),
            invisible: OrderedSet(_.map(_.filter(projects,
                d => d.team === -1), "name"
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

        this.features = _.mapValues(features, group => _.isArray(group) ?
            OrderedSet(group) : group
        );
        this.features.known = Array.from(
            this.features.all.subtract(this.features.meta)
        );
        this.features.selected = this.features.default
            .subtract(this.features.meta);
        this.features.team = this.features.selected;
        this.features.project = this.features.selected;
        this.features.visible = this.features.selected;
        this.features.compound = OrderedSet(_.keys(this.features.expressions));
        this.features.attributes = OrderedSet(
            _.flatten(_.map(this.features.expressions,
                expression => expression.attributes
            ))
        );
        this.features.format = {
            assignment: (feature, locale, values) => this.getAssignment(feature,
                locale, values
            )
        };
        this.features.changed = false;

        this.locales = locales;
        this.localization = localization;
        this.localization.sources.feature = _.mapValues(
            this.localization.sources.feature, features => new Set(features)
        );

        this.formatter = {
            selected: format.known[0].name,
            current: null,
            data: null,
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
            current: 0,
            last: sprints.limit,
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
                    this.sprints.last = Math.min(this.sprints.limit, num[0]);
                }
                else if (num.length === 1) {
                    this.sprints.first = 0;
                    this.sprints.last = Number(num[0]);
                }
                else if (num.length === 2) {
                    this.sprints.first = Number(num[0]);
                    this.sprints.current = Math.max(0, this.sprints.first);
                    this.sprints.last = Number(num[1]);
                }
                else {
                    this.sprints.first = Number(num[0]);
                    this.sprints.current = Number(num[1]);
                    this.sprints.last = Number(num[2]);
                }
            },
            closed: (closed) => {
                this.sprints.closedOnly = closed[0] === '1';
            },
            meta: (meta) => {
                const selected = OrderedSet(_.intersection(meta,
                    this.sprint_meta.known
                ));
                if (!selected.equals(this.sprint_meta.selected)) {
                    this.sprint_meta.selected = selected;
                    this.sprint_meta.changed = true;
                }
            },
            config: (visible) => {
                const toggle = d3.select('#options a[data-toggle=config]');
                const d = toggle.datum();
                if (d && d.state !== visible[0]) {
                    this.clickToggle(d3.select('#config'), d.state === '0',
                        d, toggle
                    );
                    d.state = visible[0];
                }
            }
        };

        this.configToggles = {
            config: (toggle, d, show) => {
                const visible = show ? '0' : '1';
                if (visible !== d.state) {
                    d.state = show ? '1' : '0';
                    toggle.attr('href', this.getUrl({config: [visible]}));
                }
            },
            sources: (toggle, d, show) => {
                if (show) {
                    const projects = Array.from(this.projects.selected);
                    const sources = new SourceAge(this.locales, this.localization);
                    sources.build(projects);
                }
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
        else if (data === null || typeof data === "undefined") {
            return this.locales.message("ellipsis");
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
        return getUrl(this.getState(), selections);
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

        const normal = this.features.default.subtract(this.features.meta);
        if (!this.features.team.equals(normal) ||
            !this.features.project.equals(normal)
        ) {
            this.features.changed = true;
        }
    }

    updateFormat(formatter) {
        if ((this.formatter.current === null ||
            formatter !== this.formatter.selected) &&
            _.some(this.formatter.known, format => format.name === formatter)) {
            this.formatter.selected = formatter;
            this.formatter.current = new this.formatter.classes[formatter](this.locales, this.localization);
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
            .each((d, i, nodes) => {
                const hidden = d3.select(`#${d.toggle}`).classed('is-hidden');
                const label = this.locales.message(`${d.toggle}-${hidden ? "show" : "hide"}`);
                d3.select(nodes[i])
                    .attr(LABEL_ATTR, label)
                    .attr(TOOLTIP_ATTR, label);
            })
            .on('click', (d, i, nodes) => {
                const config = d3.select(`#${d.toggle}`);
                const hidden = config.classed('is-hidden');
                const toggle = d3.select(nodes[i]);

                if (this.configToggles[d.toggle]) {
                    this.configToggles[d.toggle](toggle, d, hidden);
                }
                this.clickToggle(config, hidden, d, toggle);
            });
    }

    clickToggle(config, hidden, d, toggle) {
        const column = d3.select(toggle.node().parentNode.parentNode.parentNode);
        column.classed('is-narrow', false).classed('is-11', true);
        config.classed('is-hidden', false)
            .style('opacity', hidden ? 0 : 1)
            .transition()
            .style('opacity', hidden ? 1 : 0)
            .on("end", function() {
                d3.select(this).classed('is-hidden', !hidden);
                column.classed('is-narrow', !hidden)
                    .classed('is-11', hidden);
                this.scrollIntoView({
                    behavior: "smooth",
                    block: "end"
                });
            });
        toggle.attr('aria-expanded', hidden ? "true" : "false")
            .attr(LABEL_ATTR, this.locales.message(`${d.toggle}-${hidden ? "hide" : "show"}`))
            .attr(TOOLTIP_ATTR, this.locales.message(`${d.toggle}-${hidden ? "hide" : "show"}`))
            .select('i')
            .classed(d.shown, hidden)
            .classed(d.hidden, !hidden);
    }

    updateToggle() {
        const options = d3.select('#options');
        options.selectAll('.toggle').each((d, i, nodes) => {
            const config = d3.select(`#${d.toggle}`);
            const hidden = _.has(d, 'state') ? d.state === '0' :
                config.classed('is-hidden');
            if (this.configToggles[d.toggle]) {
                this.configToggles[d.toggle](d3.select(nodes[i]), d, !hidden);
            }
        });
        options.classed("is-hidden", false);
    }

    setAccessible(projects, spinner) {
        projects = OrderedSet(projects);
        if (projects.isEmpty() || projects.has('*')) {
            return;
        }
        this.projects.meta = _.map(this.projects.meta, project => {
            project.accessible = _.isArray(project.project_names) ?
                !projects.intersect(project.project_names).isEmpty() :
                projects.has(project.project_names);
            return project;
        });
        this.updateProjectNavigation("update");
        const prefix = '#project_';
        const hash = decodeURIComponent(window.location.hash);
        if (hash.startsWith(prefix) && hash.includes("~accessible")) {
            spinner.start();
            this.setCurrentItem(hash.slice(prefix.length));
            this.updateProjects();
            this.makeSprintSelection();
            this.makeFeatureSelection();
            this.makeFormatSelection();
            this.makeFormat(spinner);
        }
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
            .attr(TOOLTIP_ATTR, d => this.locales.attribute("project-filter-title", d.key));
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

    convertProject(project) {
        const groups = {
            "~all": () => this.projects.known,
            "~team": () => _.map(
                _.filter(this.projects.meta, d => d.recent && d.team), "name"
            ),
            "~accessible": () => _.map(_.filter(this.projects.meta,
                d => d.recent && d.accessible && d.team
            ), "name"),
            "~recent": () => _.map(
                _.filter(this.projects.meta, d => d.core && d.recent), "name"
            ),
            "~support": () => _.map(
                _.filter(this.projects.meta, d => !d.core), "name"
            )
        };
        return groups[project] ? groups[project]() : project;
    }

    setCurrentItem(project) {
        const parts = project.split(/[!|]/);

        _.forEach(parts, (value, index) => {
            if (index === 0) {
                const known = new Set(this.projects.known);
                const names = _.flatten(_.map(value.split(/[,&]/),
                    name => this.convertProject(name)
                ));
                this.projects.selected = OrderedSet(names).intersect(known);
                this.projects.visible =
                    this.projects.selected.subtract(this.projects.invisible);
            }
            else {
                const sep = value.indexOf('_');
                const name = value.substr(0, sep);
                const values = value.substr(sep + 1).split(/[,&]/);
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
                classes: "is-link"
            },
            {
                name: "",
                display_name: null,
                message: this.locales.message("projects-deselect"),
                title: this.locales.message("projects-deselect-title"),
                projects: () => OrderedSet(),
                classes: "is-danger"
            }
        ]);
        this.projectNavigation[method](projectFilter());
    }

    updateProjects(element=null, list=null) {
        if (list === null) {
            list = d3.selectAll('#navigation ul li');
        }
        if (element === null) {
            element = list.selectAll('a');
        }
        const updateList = list.merge(list.enter());
        element.each((d, i, nodes) => {
            d3.select(nodes[i].parentNode)
                .classed('is-active', d => this.isProjectActive(d.name));
        });
        element.attr('class', d => `tooltip has-tooltip-multiline has-tooltip-center ${d.classes || ""}`)
            .attr(TOOLTIP_ATTR, d => this.getProjectTooltip(d, updateList))
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
    }

    makeProjectNavigation(spinner) {
        // Create project navigation
        const updateSelection = () => {
            this.updateProjects();
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

                this.updateProjects(element);
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
                this.updateProjects(element.selectAll('a'), element);
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
        const hash = decodeURIComponent(window.location.hash);
        if (hash.startsWith(prefix)) {
            this.setCurrentItem(hash.slice(prefix.length));
        }
        this.updateProjectNavigation("start");
    }

    addDrag(element, config) {
        addDrag(this.getState(), element, config);
    }

    makeSprintSelection() {
        const selection = new SprintSelection(this.getState(),
            this.localization, this.locales
        );
        selection.makeSprintBrush();
        selection.makeSprintSelect();
        selection.makeSprintFilter();
        selection.makeSprintMeta();
    }

    makeFeatureSelection() {
        const selection = new FeatureSelection(this.getState(),
            this.localization, this.locales
        );
        selection.makeFeatureCategories();
        selection.makeSelectedFeatures();
    }

    getAssignment(feature, locales=["descriptions"], values=null) {
        const assignment = this.features.expressions[feature];
        if (!assignment || !assignment.expression) {
            return null;
        }

        if (!assignment.attributes) {
            return assignment.expression;
        }
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
                }, {text: "%s"}).text;
                if (values !== null) {
                    const value = values[attribute];
                    if (this.formatter.current !== null) {
                        unit = this.formatter.current
                            .formatUnitText(attribute, value, unit);
                    }
                    else {
                        unit = vsprintf(unit, [value]);
                    }
                }
                return `${p1 || ""}${unit}${p2 || ""}`;
            }
        );
    }

    makeFormatSelection() {
        const formats = d3.select('#format ul').selectAll('li')
            .data(this.formatter.known);
        const newFormats = formats.enter()
            .append('li')
            .attr('id', d => `format-${d.name}`)
            .classed('tooltip has-tooltip-multiline has-tooltip-bottom', true)
            .attr('data-tooltip', d => this.locales.attribute("format-tooltip", d.name));
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

    getState() {
        return {
            projects: this.projects,
            features: this.features,
            sprints: this.sprints,
            sprint_meta: this.sprint_meta,
            formatter: this.formatter
        };
    }

    makeFormat(spinner) {
        if (this.formatter.current === null) {
            this.updateFormat(this.formatter.selected);
        }
        this.formatter.current.build(this.getState(), spinner)
            .then((data) => {
                this.formatter.data = data;
                this.setTitle();
            });
    }

    makeExportOptions() {
        const button = d3.select('#export')
            .selectAll('button')
            .data(this.exporter.known)
            .enter()
            .append('button')
            .classed('button tooltip has-tooltip-bottom', true)
            .attr(TOOLTIP_ATTR, d => this.locales.attribute('export_tooltip', d.name))
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
                this.localization, this.getState()
            );
            exporter.setCurrentUrl(this.getUrl(exporter.getUrlSelection()));
            exporter.build(activeButton, this.formatter.data);
        });
    }
}

export default Builder;
