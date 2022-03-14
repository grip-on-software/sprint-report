import _ from 'lodash';
import * as d3 from 'd3';
import axios from 'axios';
import {sankey, sankeyLinkHorizontal} from 'd3-sankey';
import {OrderedSet} from 'immutable';
import {sprintsToFeatures} from '../data';
import {Chart, linspace} from './Chart';
import {STROKE_WIDTH_ATTR} from '../attrs';

/**
 * Sankey volume flow chart output format.
 */
export default class SankeyChart extends Chart {
    initialize() {
        super.initialize();
        this.content.append("div")
            .attr("id", "sankey-warning")
            .classed("notification is-warning is-hidden", true);
        this.scheme = _.concat(this.scheme, ['#ababab']);
    }

    orderSprints(sprints) {
        return sprints;
    }

    requestConfig() {
        return _.assign({}, super.requestConfig(), {
            details: true
        });
    }

    format(data, state, resolve) {
        // Determine if there are features with details (which hopefully give
        // a breakdown of each feature with volumes that can be cross-referenced
        // by e.g. issue keys)
        const noDetailsSelected = !state.projects.selected.isEmpty() &&
            state.features.details.intersect(state.features.selected).isEmpty();
        this.content.select("#sankey-warning")
            .classed("is-hidden", !noDetailsSelected);
        this.content.selectAll("svg")
            .classed("is-invisible", noDetailsSelected);
        if (noDetailsSelected) {
            this.content.select("#sankey-warning")
                .text(this.locales.message("sankey-no-details-selected"));
            resolve(data);
            return;
        }

        // Create Sankey charts with group elements for nodes and links
        const { projects, newProjects, newCharts } =
            this.createCharts(data, state);
        newProjects.append("g").classed("nodes", true);
        newProjects.append("g").classed("links", true);

        newCharts.classed("sankey", true);

        const updateProjects = newCharts.merge(projects).order()
            .select("g");

        const t = this.makeTransition(data, resolve);

        this.updateLegends(state, updateProjects, {
            t: t,
            sample: legend => legend.append("rect")
                .attr("x", -15)
                .attr("y", -18)
                .attr("width", 15)
                .attr("height", 18)
                .attr("stroke", "#000")
        });

        updateProjects.each(
            (d, i, nodes) => this.updateChart(state, d3.select(nodes[i]), d, i, t)
        );
        resolve(data);
    }

    updateChart(state, chart, d, i, t) {
        const data = sprintsToFeatures(d.sprints, state.features.visible,
            state.features.visible, {unwrap: true}
        );

        const width = this.width - this.legendWidths[i];
        var x = d3.scaleOrdinal()
            .range(linspace(0, width, d.sprints.length))
            .domain(_.range(d.sprints.length));

        this.updateAxes(chart, state, d, {x, y: () => 0}, {y: null});

        chart.select("g.features").selectAll("g.feature")
            .each((f, j, features) => {});

        const diagram = sankey()
            .nodeId(d => d.key)
            .nodeAlign(
                (node, n) => n < d.sprints.length || d.sprints.length <= 1 ?
                    node.depth :
                    (node.sprint_id / (d.sprints.length - 1)) * (n - 1)
            )
            .nodeWidth(15)
            .nodePadding(10)
            .nodeSort(d.sprints.length <= 1 ? null : (firstNode, secondNode) => {
                if (firstNode.index < secondNode.index) {
                    return -1;
                }
                if (firstNode.index > secondNode.index) {
                    return 1;
                }
                return 0;
            })
            .extent([[1, 1], [width - 1, this.height - 5]]);

        // Select the details of features to retrieve which were not obtained
        // through the default details
        const extra = Array.from(state.features.details
            .intersect(state.features.selected)
            .subtract(state.features.default));

        axios.all(_.map(Array.from(extra),
            f => axios.get(`data/${d.project_name}/details.${f}.json`)
        )).then(detailsRequests => {
            const details = _.assign({},
                _.pick(d.details, Array.from(state.features.selected)),
                _.fromPairs(_.map(detailsRequests,
                    (detailsData, i) => [extra[i], _.pick(detailsData.data,
                        _.map(d.sprints, s => _.isArray(s.sprint_id) ?
                            s.sprint_id[0] : s.sprint_id
                        )
                    )]
                ))
            );
            this.updateSankey(chart, diagram, state, t, {
                sprints: d.sprints,
                features: data,
                details: details
            });
        });
    }

    /**
     * Update the contents of a Sankey chart for a project using the sprints,
     * features, and details data.
     */
    updateSankey(chart, diagram, state, t, data) {
        const height = this.height;
        // Create a link path which does not get out of the node sizes which
        // sometimes happens with large nodes positioned nearby horizontally.
        const updateLinkPath = (link) => link.attr("d", sankeyLinkHorizontal())
            .attr("clip-path", d => `inset(
                ${Math.min(d.target.y0, d.source.y0)}
                ${this.svgWidth + this.textHeight - d.target.x0}
                ${height - Math.max(d.target.y1, d.source.y1)}
                ${d.source.x1}
            ) view-box`);

        const padding = diagram.nodePadding();
        const within = (y, node) => y >= node.y0 && y <= node.y1;
        const nodeOverlaps = (d, node) => {
            // Nodes in different sprints are not overlapping
            if (d.x0 !== node.x0) {
                return false;
            }
            // The nodes only overlap if the target node has its top or bottom
            // side within the dragged node, and if there is enough space
            // created by draggin the node for the target node to be placed in.
            return (within(d.y0, node) || within(d.y1, node)) &&
                Math.abs(node.y0 - node.yOrig) > (d.y1 - d.y0) + padding;
        };

        const { nodes, links } = this.convertSankey(diagram, data, state);

        const updateNodes = chart.select("g.nodes")
            .attr("stroke", "#000")
            .selectAll("g")
            .data(nodes, d => d.key);

        updateNodes.exit().remove();
        const newNodes = updateNodes.enter()
            .append("g")
            .call(d3.drag().on("start", function(node) {
                node.yOrig = node.y0;
                this.parentNode.appendChild(this);
            }).on("drag", function(node) {
                // Update node position from drag
                const previous = node.y0;
                node.y0 = Math.max(0, Math.min(height - (node.y1 - node.y0),
                    node.y0 + d3.event.dy
                ));
                node.y1 += node.y0 - previous;
                d3.select(this)
                    .attr("transform", `translate(${node.x0}, ${node.y0})`);
                chart.select("g.nodes")
                    .selectAll("g")
                    .filter(d => d !== node && d.x0 === node.x0 &&
                        nodeOverlaps(d, node)
                    )
                    .each((d, i, nodes) => {
                        // Adjust position of target node based on dragged node
                        // origin so that the space is now near the dragged node
                        node.yOrig = node.y0;
                        const offset = d3.event.dy > 0 ?
                            node.y0 - (d.y1 - d.y0) - padding :
                            node.y0 + (node.y1 - node.y0) + padding;
                        d.y1 = offset + (d.y1 - d.y0);
                        d.y0 = offset;
                        d3.select(nodes[i])
                            .attr("transform", `translate(${d.x0}, ${d.y0})`);
                    });
                diagram.update({
                    nodes: chart.select("g.nodes").selectAll("g").data(),
                    links: chart.select("g.links").selectAll("g").data()
                });
                chart.select("g.links")
                    .selectAll("g path")
                    .call(updateLinkPath);
            }));

        // Determine positions of nodes
        newNodes
            .attr("transform", d => _.isNaN(d.y1) ? "translate(0, 0)" :
                `translate(${d.x0}, ${height - (d.y1 - d.y0)})`
            )
            .merge(updateNodes)
            .transition(t)
            .attr("transform", d => _.isNaN(d.y0) ? "translate(0, 0)" :
                `translate(${d.x0}, ${d.y0})`
            );

        // Create hover tooltips for nodes to indicate the sprint and feature
        newNodes.append("title").each((d, i, nodes) => {
            const node = d3.select(nodes[i]);
            node.append("text").text(`${this.formatSprint(
                data.sprints[d.sprint_id], node, state.sprint_meta, "main"
            )}\n${this.locales.retrieve(this.localization.descriptions,
                d.feature_key
            )}\n`);
            this.formatFeature(d.feature_key, d.value, node.append("text"),
                {svg: true}
            );
        });

        // Create the nodes themselves
        newNodes.append("rect")
            .attr("height", 0)
            .merge(updateNodes.select("rect"))
            .attr("stroke-dasharray", d => d.partial ? 4 : null)
            .transition(t)
            .attr("fill", d => this.scheme[d.visible_index % this.scheme.length])
            .attr("width", d => _.isNaN(d.x1) ? diagram.nodeWidth() :
                d.x1 - d.x0
            )
            .attr("height", d => _.isNaN(d.y1) ? 0 : d.y1 - d.y0);

        // Create the links
        const updateLinks = chart.select("g.links")
            .attr("fill", "none")
            .selectAll("g")
            .data(links, d => `${d.source.key}-${d.target.key}`);

        updateLinks.exit().remove();
        const newLinks = updateLinks.enter()
            .append("g")
            .style("mix-blend-mode", "multiply");

        // Create hover tooltips for links that indicate the old and new sprints
        // and the old and new features and the link value
        newLinks.append("title")
            .classed("title", true)
            .each((d, i, nodes) => {
                const node = d3.select(nodes[i]);
                node.append("text").text(`${this.formatSprint(
                    data.sprints[d.source.sprint_id],
                    node, state.sprint_meta, "main"
                )} \u21d2 ${this.formatSprint(data.sprints[d.target.sprint_id],
                    node, state.sprint_meta, "main"
                )}\n${this.locales.retrieve(this.localization.descriptions,
                    d.source.feature_key
                )} \u21d2 ${this.locales.retrieve(this.localization.descriptions,
                    d.target.feature_key
                )}\n`);
                this.formatFeature(d.source.feature_key, d.value,
                    node.append("text"), {svg: true}
                );
            });

        // Update the link colors and paths
        newLinks.append("path")
            .merge(updateLinks.select("path"))
            .transition(t)
            .attr("stroke", d => this.scheme[d.source.visible_index % this.scheme.length])
            .attr(STROKE_WIDTH_ATTR, d => d.width)
            .call(updateLinkPath);
    }

    /**
     * Determine the nodes to display for each sprint and feature.
     */
    getNodes(sprints, data, details) {
        return _.concat(
            _.map(sprints, (s, i) => ({
                key: `${i}-_extra`,
                sprint_id: i,
                partial: true,
                feature_key: '?',
                index: -1,
                visible_index: this.scheme.length - 1,
            })),
            _.flattenDeep(_.map(data, f => _.map(f.sprints, (s, i) => {
                const sprint = this.getSprintDetails(details[f.feature_key],
                    sprints[i].sprint_id
                );
                return sprint && sprint.key ? _.assign({}, {
                    key: `${i}-${f.feature_key}`,
                    sprint_id: i,
                    value: s,
                    index: f.visible_index
                }, _.pick(f, ['feature_key', 'visible_index'])) : [];
            })))
        );
    }

    /**
     * Obtain the value of an individual detail item.
     */
    getPoints(detail, i, value) {
        if (detail.story_points) {
            return this.defined(detail.story_points[i]) ?
                Number(detail.story_points[i]) : 0;
        }
        return value / detail.key.length;
    }

    /**
     * Determine a link between two features from a sprint and its predecessor.
     * If the link should be displayed, then the link is an object with the
     * source, target and value, nested in an array (with only one item). If the
     * link is not displayed because there are no details or they have no value,
     * then an empty array is returned.
     */
    getLink(sprints, sprint, keys, i, featurePair) {
        const [feature, otherFeature] = featurePair;
        if (keys.isEmpty()) {
            return [];
        }
        const value = _.sum(_.map(sprint.key,
            (k, j) => keys.includes(k) ?
                this.getPoints(sprint, j, sprints[i][feature]) : 0
        ));
        if (value === 0) {
            return [];
        }
        return [{
            source: i > 0 ? `${i - 1}-${otherFeature}` : `${i}-${feature}`,
            target: i > 0 ? `${i}-${feature}` : `${i + 1}-${otherFeature}`,
            value: value
        }];
    }

    /**
     * Determine a set of features which can be linked with the feature.
     */
    getCandidateFeatures(features, earlierFeatures, feature) {
        return feature.startsWith('backlog_') ?
            features.delete(feature) :
            earlierFeatures.filter(f => !f.startsWith('backlog_'));
    }

    /**
     * Filter keys from details of a feature such that keys that are also used
     * in details of other features are no longer included for this one too.
     */
    cleanDuplicates(details, candidates, keys, id) {
        return _.reduce(Array.from(candidates),
            (accumulator, concurrentFeature) => {
                const sprint = this.getSprintDetails(
                    details[concurrentFeature], id
                );
                if (!sprint.key) {
                    return accumulator;
                }
                return accumulator.subtract(sprint.key);
            },
            OrderedSet(keys)
        );
    }

    /**
     * Create nodes and links for the features based on their details.
     */
    convertSankey(diagram, data, state) {
        const nodes = this.getNodes(data.sprints, data.features, data.details);

        const features = state.features.selected.intersect(state.features.details);
        const getLinks = (feature, earlierFeatures, s, i, otherSprintId) => {
            const detail = data.details[feature];
            const sprint = this.getSprintDetails(detail, s.sprint_id);
            if (!sprint.key) {
                return [];
            }
            var remainingKeys = this.cleanDuplicates(data.details,
                this.getCandidateFeatures(features, earlierFeatures, feature),
                sprint.key, s.sprint_id
            );
            var link = _.map(data.details, (otherDetail, otherFeature) => {
                const otherSprint = this.getSprintDetails(otherDetail,
                    otherSprintId
                );
                if (!otherSprint.key) {
                    return [];
                }
                const keys = remainingKeys.intersect(otherSprint.key);
                remainingKeys = remainingKeys.subtract(keys);
                if (i > 0) {
                    return this.getLink(data.sprints, sprint, keys, i,
                        [feature, otherFeature]
                    );
                }
                return [];
            });
            if (!remainingKeys.isEmpty()) {
                const extraLink = this.getLink(data.sprints, sprint,
                    remainingKeys, i, [feature, "_extra"]
                );
                link = link.concat(_.map(extraLink, l => _.assign({}, l, {
                    partial: true
                })));
            }
            return link;
        };

        // Determine the links between features of different sprints, based on
        // their details, avoiding duplicate details keys and adding the
        // remaining incoming volumes from extra nodes.
        const getSprintLinks = (s, i) => {
            const otherSprintId = data.sprints[i === 0 ? i + 1 : i - 1].sprint_id;
            var earlierFeatures = OrderedSet();
            return _.concat(_.map(Array.from(features), feature => {
                const link = getLinks(feature, earlierFeatures, s, i,
                    otherSprintId
                );
                earlierFeatures = earlierFeatures.add(feature);
                return link;
            }), i === 0 ? [] : {
                source: `${i - 1}-_extra`,
                target: `${i}-_extra`,
                value: 0
            });
        };

        const links = data.sprints.length === 1 ? [] :
            _.flattenDeep(_.map(data.sprints, (s, i) => getSprintLinks(s, i)));

        return diagram({
            nodes: nodes,
            links: links
        });
    }
}
