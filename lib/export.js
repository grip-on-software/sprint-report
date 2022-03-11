import _ from 'lodash';
import * as d3 from 'd3';
import axios from 'axios';
import copy from 'copy-to-clipboard';
import JSZip from 'jszip';
import config from 'config.json';
import {vsprintf} from 'sprintf-js';
import {getRequests, makeRequests, getSprintMeta} from './data';
import known from './export.json';
import {TOOLTIP_ATTR} from './attrs';

/* Helper function to end the loading spinner within the button */
const stopButton = (button) => {
    button.classed('is-loading', false);
};

/**
 * Base class for export types.
 */
class Export {
    constructor(locales, localization, state) {
        this.locales = locales;
        this.localization = localization;
        this.state = state;
        this.url = null;
    }

    /**
     * Additional URL fields to use for the current URL, even if the report
     * does not have these fields and values. The exporter can then use this
     * URL for it own needs, for example for the configuration panel to be
     * closed in its exported format.
     */
    getUrlSelection() {
        return {};
    }

    /**
     * Update the URL to use within the exporter.
     */
    setCurrentUrl(url) {
        this.url = url;
    }

    /**
     * Retrieve the name of the file if the export provides a link to open.
     */
    filename() {
        return "sprint-report";
    }

    /**
     * An object to provide to makeRequests that indicates which fields to
     * retrieve for projects and/or how to process them.
     */
    requestConfig() {
        return {sprints: sprint => sprint};
    }

    /**
     * Perform the export after a click on the export type's button.
     *
     * Possibly, existing data of an output format can be provided, which is
     * used for the export instead of collecting the data ourselves.
     */
    build(button, data=null) {
        const handleData = (data) => {
            const url = this.format(data);
            if (url) {
                this.openLink(url);
            }
            button.call(stopButton);
        };

        if (data !== null) {
            handleData(data);
            return;
        }

        makeRequests(this.state, this.requestConfig())
            .then(handleData)
            .catch((error) => {
                d3.select('#error-message')
                    .classed('is-hidden', false)
                    .text(this.locales.message("error-message", [error]));
                throw error;
            });
    }

    /**
     * If the export provides a link to open, then create a hidden element to
     * click on with the proper browser context options, such as the target
     * context (for example '_blank') and the download filename.
     */
    openLink(url, target=null) {
        const link = d3.select(document.body)
            .append('a')
            .classed('is-hidden', true)
            .attr('target', target)
            .attr('href', url)
            .attr('download', this.filename());
        link.node().click();
        link.remove();
    }
}

/**
 * Download a CSV (comma separated values) table-like export.
 */
class CSV extends Export {
    /**
     * Adjust the export of a value so that it is valid in CSV.
     */
    quote(value) {
        if (typeof value === "undefined" || value === null) {
            value = "";
        }
        value = String(value).replace(/"/g, '""');
        if (value.search(/(?:"|,|\n)/g) >= 0) {
            value = `"${value}"`;
        }
        return value;
    }

    format(data) {
        const meta = getSprintMeta(this.state.sprint_meta, "main");
        const columns = _.concat(this.locales.message("project-name"),
            this.locales.attribute("sprint_meta", meta),
            _.map(Array.from(this.state.features.selected),
                (feature) => this.locales.retrieve(this.localization.descriptions,
                    feature
                )
            )
        );
        const rows = _.concat([columns], _.reduce(data, (result, project) => {
            _.forEach(project.sprints, (sprint) => {
                result.push(_.concat(
                    project.display_name || project.project_name, sprint[meta],
                    _.map(Array.from(this.state.features.selected),
                        (feature) => sprint[feature]
                    )
                ));
            });
            return result;
        }, []));
        const csv = _.map(rows,
            row => _.map(row, this.quote).join(',')
        ).join('\r\n');
        const blob = new Blob([csv], {type: 'text/csv'});
        return URL.createObjectURL(blob);
    }

    filename() {
        return "sprint-report.csv";
    }
}

/**
 * Download a JSON object notation export of the data in the report.
 */
class JSONSource extends Export {
    requestConfig() {
        return _.assign({}, super.requestConfig(), {
            links: true,
            details: true,
            sources: true,
            future: true
        });
    }

    format(data) {
        const json = window.JSON.stringify(data, null, 4);
        const blob = new Blob([json], {type: 'application/json'});
        return URL.createObjectURL(blob);
    }

    filename() {
        return null;
    }
}

/**
 * Download a ZIP export of the visualization report (HTML, JS, CSS) with data
 * limited to currently selected projects/sprints/features for offline usage.
 */
class HTML extends Export {
    /**
     * Make a variable suitable for export in JSON or JavaScript.
     */
    json(obj) {
        return window.JSON.stringify(obj);
    }

    build(button) {
        this.zip = new JSZip();

        const promises = [
            new Promise((resolve, reject) => this.writeStatic(resolve, reject)),
            new Promise((resolve, reject) => this.writeManifest(resolve, reject)),
            new Promise((resolve, reject) => this.writeProject(resolve, reject))
        ];

        Promise.all(promises).then(() => {
            this.zip.generateAsync({type: "blob"}).then(blob => {
                const url = URL.createObjectURL(blob);
                this.openLink(url);
                this.zip = null;
                button.call(stopButton);
            });
        }).catch(error => {
            button.call(stopButton)
                .classed('has-tooltip-danger has-tooltip-multiline', true)
                .attr(TOOLTIP_ATTR, this.locales.message("error-message", [error]));
        });
    }

    /**
     * Write static files (HTML, CSS, JS) and some data files to the ZIP.
     */
    writeStatic(resolve, reject) {
        const staticFiles = ['index.html', 'main.css', 'bundle.js'];
        const staticRequests = _.map(staticFiles, file => axios.get(file, {
            responseType: 'text',
            transformResponse: []
        }));

        axios.all(staticRequests).then((staticResponses) => {
            // Adjust the bundle.js to immediately set the anchor
            _.forEach(staticFiles, (file, index) => {
                this.zip.file(file, staticResponses[index].data + (
                    file === 'bundle.js' ? `\x0Adocument.location.hash = ${this.json(this.url)};` : ''
                ));
            });

            // Export the necessary data file
            const data = this.zip.folder("data");
            data.file('projects_meta.json', this.json(_.filter(this.state.projects.meta,
                project => this.state.projects.selected.has(project.name)
            )));
            data.file('features.json', this.json(_.mapValues(
                _.omit(this.state.features,
                    ['known', 'selected', 'visible', 'expressions', 'format', 'changed']
                ),
                features => Array.from(this.state.features.selected.intersect(features))
            )));
            data.file('expressions.json',
                this.json(this.state.features.expressions)
            );

            // Export localization files
            _.forEach(this.localization, (localization, key) => {
                data.file(`${key}.json`, this.json(localization));
            });

            // Export actual sprint data
            const sprints = {
                limit: this.state.sprints.limit,
                old: this.state.sprints.last > this.state.sprints.limit,
                closed: this.state.sprints.closed
            };
            data.file('sprints.json', this.json(sprints));

            resolve();
        }).catch(error => {
            reject(error);
        });
    }

    /**
     * Write all files referenced by the manifest of the visualization.
     */
    writeManifest(resolve, reject) {
        axios.get('manifest.json').then(manifest => {
            this.zip.file('manifest.json', this.json(manifest.data));

            const manifestPaths = _.values(_.pickBy(manifest.data,
                path => path.substring(0, 1) !== '/'
            ));
            const manifestRequests = _.map(manifestPaths,
                path => axios.get(path, {
                    responseType: 'text',
                    transformResponse: []
                })
            );
            axios.all(manifestRequests).then((manifestResponses) => {
                _.forEach(manifestPaths, (path, index) => {
                    this.zip.file(path.split('?', 1),
                        manifestResponses[index].data
                    );
                });

                resolve();
            }).catch(error => {
                reject(error);
            });
        }).catch(error => {
            reject(error);
        });
    }

    /**
     * Write sprint feature data for the selected projects.
     */
    writeProject(resolve, reject) {
        const {auxiliaryKeys, requests} = getRequests(this.state, {
            links: true,
            details: true,
            sources: true
        });
        requests.then((responses) => {
            const projectRequests = _.zip(Array.from(this.state.projects.selected),
                _.chunk(responses, auxiliaryKeys.length)
            );
            const data = this.zip.folder("data");
            _.forEach(projectRequests, (project) => {
                const projectData = data.folder(project[0]);
                _.forEach(auxiliaryKeys, (key, index) => {
                    projectData.file(`${key === "" ? "default" : key}.json`,
                        this.json(project[1][index].data)
                    );
                });
            });

            resolve();
        }).catch(error => {
            reject(error);
        });
    }

    getUrlSelection() {
        return {config: ['0']};
    }

    filename() {
        return "sprint-report.zip";
    }
}

/**
 * Copy the URL of the report to the clipboard.
 */
class Link extends Export {
    build(button) {
        const locales = this.locales;
        button.classed('tooltip has-tooltip-info', true)
            .attr(TOOLTIP_ATTR, locales.message('export-link-tooltip'));
        copy(document.location.href, {
            message: this.locales.message('export-link-copy')
        });
        button.call(stopButton)
            .on('mouseout', function() {
                button.classed('has-tooltip-info', false)
                    .attr(TOOLTIP_ATTR, locales.attribute('export_tooltip', 'link'))
                    .on('mouseout', null);
            });
    }
}

/**
 * Print the report.
 */
class Print extends Export {
    build(button) {
        window.print();
        button.call(stopButton);
    }
}

/**
 * Open a PDF rendering of the report using an external PDF rendering service.
 */
class PDF extends Export {
    build(button) {
        const projects = Array.from(this.state.projects.selected).join(', ');
        const query = encodeURIComponent(`?lang=${this.locales.lang}`);
        const url = vsprintf(config.render_url, [
            `${config.visualization_url}sprint-report/${query}${encodeURIComponent(this.url)}`,
            projects === '' ? this.locales.message("title") :
                this.locales.message("title-projects", [projects])
        ]);
        this.openLink(url, '_blank');
        button.call(stopButton);
    }
}

export default { CSV, JSONSource, HTML, Link, Print, PDF, known };
