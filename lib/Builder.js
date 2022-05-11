/**
 * Sprint report builder.
 *
 * Copyright 2017-2020 ICTU
 * Copyright 2017-2022 Leiden University
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
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

/**
 * Builder that controls the sprint report page.
 */
class Builder {
    constructor(projects, features, locales, localization, sprints) {
        // Project/team/component details:
        // - All projects (known)
        // - The ones that are teams (and their associated project IDs)
        // - Whether they should be shown when selected by the user (some teams
        //   may be set as invisible to avoid displaying an aggregate of the
        //   projects when the team does not need that)
        // - The selection of the user
        // - The projects that will be visible in the report
        this.projects = {
            known: _.map(projects, "name"),
            teams: OrderedSet(_.map(_.filter(projects,
                d => _.isArray(d.project_names) || _.isArray(d.project_ids)),
                "name"
            )),
            invisible: OrderedSet(_.map(_.filter(projects,
                d => d.team === -1), "name"
            )),
            selected: OrderedSet(),
            visible: OrderedSet()
        };

        // Collect the other details of the projects as metadata. This includes
        // recent, core, team, component, num_sprints, future_sprints fields,
        // as well as project_ids/project_names (the former only in anonymized
        // reports), fixversions, and accessible.
        const meta = _.zipObject(this.projects.known, _.map(projects,
            project => {
                if (_.isArray(project.project_ids)) {
                    project.project_names = _.map(project.project_ids,
                        id => `Proj${id}`
                    );
                }
                return _.assign({}, project, {accessible: true});
            }
        ));
        this.projects.meta = projects[0].fixversions ? _.mapValues(meta,
            project => _.assign({}, project, {
                fixversions: _.merge(..._.map(_.isArray(project.project_names) ?
                    project.project_names : [project.project_names],
                    key => _.get(meta[key], 'fixversions', {})
                ))
            })
        ) : meta;

        // Use the best display name of the project, or null if this would be
        // superfluous compared to the normal name (for example in table format)
        this.projects.display_names = _.zipObject(this.projects.known,
            _.map(projects, (meta) =>
                meta.name !== meta.quality_display_name ?
                meta.quality_display_name : null
            )
        );

        // Feature details:
        // - The initial selection (default)
        // - Known features and sprint metadata fields (all)
        // - Features with predictions (future)
        // - Features with structured source traces (details)
        // - Features collected from a quality dashboard (metrics)
        // - Sprint metadata fields (meta)
        // Also includes features with expressions, and the following:
        // - All features excluding sprint metadata fields (known)
        // - The selection of the user, also split out to be shown only for
        //   team or project
        // - The names of features based on an expression (compound)
        // - The names of features used within an expression (attributes)
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

        // Track whether the user made a different selection than the default,
        // including whether to show a feature only for team or project
        this.features.changed = false;

        this.locales = locales;
        this.localization = localization;
        this.localization.sources.feature = _.mapValues(
            this.localization.sources.feature, features => new Set(features)
        );

        // Output format types and state (selected format, old output, data used
        // and all known formats)
        this.formatter = {
            selected: format.known[0].name,
            current: null,
            data: null,
            known: format.known
        };
        this.formatter.classes = _.fromPairs(_.map(this.formatter.known,
            (formatter) => [formatter.name, format[formatter.class]]
        ));

        // Export types
        this.exporter = {
            known: _.filter(exports.known,
                exporter => !exporter.config || config[exporter.config] !== ""
            )
        };
        this.exporter.classes = _.fromPairs(_.map(this.exporter.known,
            (exporter) => [exporter.name, exports[exporter.class]]
        ));

        // Sprint selection state:
        // - Default number of sprints to show (limit)
        // - Whether the data contains only sprints that have ended (closed)
        // - Whether the data contains sprints earlier than the limit (old)
        // - The number of sprints that can be shown for predictions (future)
        // As well as:
        // - Number of sprints to go back from most recent sprint, or number
        //   of future sprints to show if negative (first)
        // - Number of sprints to go back to start showing (current)
        // - Number of sprints to go back to stop showing at (last)
        // - Whether to filter out sprints that are still open (closedOnly)
        this.sprints = _.assign({}, sprints, {
            first: 0,
            current: 0,
            last: sprints.limit,
            closedOnly: false
        });

        // Sprint metadata fields:
        // - All the meta (known)
        // - The fields to shown in the report (selected)
        // - Whether the field contains only numbers (numeric)
        // - If the user made a different selection than the default (changed)
        // - Formatters for longer displays of metadata values
        this.sprint_meta = {
            known: _.intersection(
                ['sprint_name', 'sprint_num', 'start_date', 'close_date'],
                Array.from(this.features.meta)
            ),
            selected: OrderedSet(['sprint_name', 'sprint_num', 'close_date'])
                .intersect(this.features.meta),
            numeric: OrderedSet(['sprint_num']),
            changed: false,
            format: {
                sprint_name: (d, node) => this.formatSprintName(d, node),
                sprint_num: (d) => this.locales.message('sprint-number', [d]),
                start_date: (d, node) => this.formatDate(d, node, "start_date"),
                close_date: (d, node) => this.formatDate(d, node, "close_date")
            }
        };

        // Actions to take when the user navigates to or clicks on a link with
        // an anchor that changes which items are shown
        this.navigationHooks = {
            feature: (keys) => this.updateFeatures(keys),
            format: (formatter) => this.updateFormat(formatter[0]),
            count: (num) => this.updateCount(num),
            closed: (closed) => {
                this.sprints.closedOnly = closed[0] === '1';
            },
            meta: (meta) => this.updateMeta(meta),
            config: (visible) => this.updateConfig(visible)
        };

        // Toggles that expand or collapse parts of the configuration panel
        this.configToggles = {
            config: (toggle, d, show) => this.toggleConfig(toggle, d, show),
            sources: (toggle, d, show) => this.toggleSources(show)
        };
    }

    /**
     * Formatter for a sprint name metadata field.
     *
     * See also Format.formatSprint
     */
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

    /**
     * Formatter for a sprint start or end date metadata field.
     *
     * See also `Format.formatSprint`.
     */
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

    /**
     * Generate a URL that considers the current state of the report plus new
     * selections of which items to show.
     */
    getUrl(selections) {
        return getUrl(this.getState(), selections);
    }

    /**
     * Select the features for inclusion in the report. The keys are an array
     * of feature keys (possibly prefixed with `team~` or `project~`).
     */
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

    /**
     * Select another format type to use for the report.
     */
    updateFormat(formatter) {
        if ((this.formatter.current === null ||
            formatter !== this.formatter.selected) &&
            _.some(this.formatter.known, format => format.name === formatter)) {
            this.formatter.selected = formatter;
            this.formatter.current = new this.formatter.classes[formatter](this.locales, this.localization);
        }
    }

    /**
     * Select the range of sprints to display. This function is provided with
     * an array of at least one, but most preferably three, numbers, which are
     * interpreted as the `last` sprint (in case of 1), the `first` and `last`
     * sprint (in case of 2 items), or the `first`, `current` and `last` sprints
     * for 3 items (any more are ignored).
     */
    updateCount(num) {
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
    }

    /**
     * Update which sprint metadata fields to allow the report to use.
     */
    updateMeta(meta) {
        const selected = OrderedSet(_.intersection(meta,
            this.sprint_meta.known
        ));
        if (!selected.equals(this.sprint_meta.selected)) {
            this.sprint_meta.selected = selected;
            this.sprint_meta.changed = true;
        }
    }

    /**
     * Update the visibility of the confiugration panel. The provided argument
     * is an arrat where the first element is the toggle state, a string which
     * is either '0' to hide the panel or '1' to show it.
     */
    updateConfig(visible) {
        const toggle = d3.select('#options a[data-toggle=config]');
        const d = toggle.datum();
        if (d && d.state !== visible[0]) {
            this.clickToggle(d3.select('#config'), d.state === '0',
                d, toggle
            );
            d.state = visible[0];
        }
    }

    /**
     * Perform additional adjustments after a toggle of the configuration panel.
     */
    toggleConfig(toggle, d, show) {
        const visible = show ? '0' : '1';
        if (visible !== d.state) {
            d.state = show ? '1' : '0';
            toggle.attr('href', this.getUrl({config: [visible]}));
        }
    }

    /**
     * Perform adjustments after a toggle of the source age panel.
     */
    toggleSources(show) {
        if (show) {
            const projects = Array.from(this.projects.selected);
            const sources = new SourceAge(this.locales, this.localization);
            sources.build(projects);
        }
    }

    /**
     * Build the configuration panel and toggles.
     */
    makeConfiguration(spinner) {
        this.makeToggle();
        // Project navigation handles current item selection which builds the
        // remaining selections in the configuration.
        this.makeProjectNavigation(spinner);
        this.makeExportOptions();
    }

    /**
     * Display the title of the report.
     * Because a PDF renderer may await until the report is ready, the title
     * should only be updated once this is the case.
     */
    setTitle() {
        const projects = Array.from(this.projects.selected).join(", ");
        const title = d3.select("#title");
        title.select("span.projects").text(projects !== "" ?
            this.locales.message("title-projects", [projects]) : ""
        );
    }

    /**
     * Create the toggles of the panels.
     */
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

    /**
     * Handle a click of a toggle. This makes the associated panel visible and
     * changes the toggle icon state.
     */
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

    /**
     * Adjust the toggles and potentially their associated panels, possibly
     * from navigating to a link.
     */
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

    /**
     * Update the selection of projects based on data detailing which projects
     * the user should see most prominently. Potentially, this function also
     * updates the entire report, if it is to show specific projects based on
     * this data.
     */
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

    /**
     * Retrieve details relevant for filtering the project navigation.
     */
    getProjectFilter() {
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

        // XOR on checked/inverse state of a filter
        const includeFilter = (checked, inverse) => (inverse && !checked) ||
            (!inverse && checked);
        const filter = (projects) => {
            const filters = [];
            d3.selectAll('#project-filter input').each(function(d) {
                const checked = d3.select(this).property('checked');
                if (includeFilter(checked, d.inverse)) {
                    filters.push(d.inverse || d.key);
                }
            });

            return _.filter(projects,
                project => _.every(filters, filter => !!project[filter])
            );
        };

        return {isRecent, isSupport, isTeam, isAccessible, filter};
    }

    /**
     * Create checkboxes that control which types of projects are displayed
     * within the project navigation.
     */
    buildProjectFilter(projectNavigation, selections) {
        const {isRecent, isSupport, isTeam, isAccessible, filter} =
            this.getProjectFilter();
        const projectFilter = () => _.concat(selections,
            filter(this.projects.meta)
        );
        const filters = [
            {key: 'recent', default: !!isRecent},
            {key: 'support', inverse: 'core', default: !!isSupport},
            {key: 'team', default: !!isTeam}
        ];
        if (config.access_url !== "") {
            filters.push({key: 'accessible', default: !!isAccessible});
        }

        const label = d3.select('#project-filter')
            .selectAll('label')
            .data(filters)
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

    /**
     * Determine the list of projects associated with a team, but only if
     * those projects are visible in the project navigation.
     */
    includeTeamProjects(updateList, d) {
        if (!_.isArray(d.project_names)) {
            return [];
        }
        const listNames = _.map(updateList.data(), p => p.name);
        const shown = _.intersection(listNames, d.project_names);
        if (_.isEmpty(shown) || (shown.length === 1 && shown[0] === d.name)) {
            return [];
        }
        return shown;
    }

    /**
     * Determine which projects a shorthand refers to.
     *
     * Valid shorthands are:
     * - '~all': All known projects.
     * - '~team': All recent projects that are actually teams.
     * - '~accessible': Recent projects that are actually teams and that should
     *   be shown prominently to the user.
     * - '~recent': All recent projects that are not support teams.
     * - '~support': All support team projects.
     */
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

    /**
     * Update what items should be shown on the report page, based on a string
     * which may start with several project keys, separated by ',' or '&'
     * characters, as well as other fields which are separated from each other
     * and from each other by '!' or '|' characters and the name of those fields
     * is separated from the new selection of values by an underscore, while
     * that field's selection uses the ',' or '&' delimiter as well.
     */
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

    /**
     * Check whether the project key is selected.
     */
    isProjectActive(key) {
        return this.projects.selected.includes(key);
    }

    /**
     * Retrieve a tooltip to display for a project within the navigation.
     */
    getProjectTooltip(d, updateList) {
        if (d.title) {
            return d.title;
        }
        let prefix = "project";
        if (_.isArray(d.project_names)) {
            prefix += "-team";
            if (_.isEmpty(this.includeTeamProjects(updateList, d))) {
                prefix += "-only";
            }
        }
        else if (d.component) {
            prefix += "-component";
        }
        const msg = `${prefix}-title-${this.isProjectActive(d.name) ? "remove" : "add"}`;
        return this.locales.message(msg, [_.isNil(d.quality_display_name) ?
            d.name : d.quality_display_name
        ]);
    }

    /**
     * Update the project navigation.
     *
     * The `method` must be a valid `Navigation` function to use, i.e., `start`
     * or `update`.
     */
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

    /**
     * Update the projects which are selected in the project navigation based on
     * a link navigation, for example.
     */
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
                let projects = null;
                if (d.projects) {
                    projects = d.projects(updateList);
                }
                else {
                    let teamProjects = this.includeTeamProjects(updateList, d);
                    projects = setToggle(OrderedSet(this.projects.selected),
                        d.name, _.isEmpty(teamProjects) ? null : teamProjects
                    );
                }
                return this.getUrl({project: projects});
            });
        element.select('span.project').text(d => d.message || d.name);
        updateOrderTags(element, this.projects, d => d.name);
    }

    /**
     * Build the project navigation as well as the remainder of the report page.
     */
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

    /**
     * Update a project navigation element to a valid drag-and-drop element for
     * reordering.
     */
    addDrag(element, config) {
        addDrag(this.getState(), element, config);
    }

    /**
     * Create or update the sprint selection in the configuration panel.
     */
    makeSprintSelection() {
        const selection = new SprintSelection(this.getState(),
            this.localization, this.locales
        );
        selection.makeSprintBrush();
        selection.makeSprintSelect();
        selection.makeSprintFilter();
        selection.makeSprintMeta();
    }

    /**
     * Create or update the feature selection in the configuration panel.
     */
    makeFeatureSelection() {
        const selection = new FeatureSelection(this.getState(),
            this.localization, this.locales
        );
        selection.makeFeatureCategories();
        selection.makeSelectedFeatures();
    }

    /**
     * Generate an expression for the feature with localized attribute names.
     */
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
                let unit = _.transform(locales, (accumulator, key) => {
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

    /**
     * Create or update the format selection in the configuration panel.
     */
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

    /**
     * Retrieve the current selection state.
     */
    getState() {
        return {
            projects: this.projects,
            features: this.features,
            sprints: this.sprints,
            sprint_meta: this.sprint_meta,
            formatter: this.formatter
        };
    }

    /**
     * Create or update the report with the selected format.
     */
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

    /**
     * Create or update the export panel.
     */
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
