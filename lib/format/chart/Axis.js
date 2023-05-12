/**
 * Chart axes.
 *
 * Copyright 2017-2020 ICTU
 * Copyright 2017-2022 Leiden University
 * Copyright 2017-2023 Leon Helwerda
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

const nonNaN = val => _.isNaN(val) ? 0 : val;

/**
 * Generic axis for a chart output format.
 */
export default class Axis {
    constructor(chart, axis, config, width, height) {
        this.chart = chart;
        this.axis = axis;
        this.config = config;
        this.width = width;
        this.height = height;
    }

    /**
     * Update the display of the axis within the chart(s).
     */
    update(t, x, y, locales, localization) {
        // Move the axis to its position in the chart
        this.chart.select(`.axis.${this.axis}`)
            .transition(t)
            .attr("transform", this.config.transform)
            .call(this.config.axis !== null ? this.config.axis :
                node => node.selectAll('*')
                    .transition(t)
                    .style("opacity", 0)
                    .remove()
            );

        // Set the axis label, possibly based on a feature and/or units
        const label = this.chart.select(`.label.${this.axis}`);
        let text = this.config.label.text;
        if (this.config.label.features) {
            if (this.config.label.features.size === 1) {
                text = locales.retrieve(localization.descriptions,
                    this.config.label.features.first()
                );
            }
            else if (localization.metadata.measurement) {
                const unit = this.config.label.features.map(f =>
                    localization.metadata.measurement[f] ?
                    localization.metadata.measurement[f].unit : null
                );
                if (unit.size === 1 && unit.first() !== null) {
                    text = locales.attribute("units", unit.first());
                }
            }
        }

        if (text) {
            label.text(text);
        }
        label.transition(t)
            .style("opacity", text ? 1 : 0)
            .attr("x", this.config.label.x)
            .attr("y", this.config.label.y);
    }
}

/**
 * Additional vertical axis that is displayed on x = 0 so that it is clear where
 * this line is when the chart has a domain with x < 0 and x > 0 visible.
 */
class XZeroAxis extends Axis {
    update(t, x, y, locales, localization) {
        const xZero = nonNaN(x(0));
        this.chart.select('.axis.x0')
            .transition(t)
            .attr("opacity", xZero < x.range()[0] || xZero > this.width ? 0 : 1)
            .attr("transform", `translate(${xZero},0)`)
            .select("line")
            .attr("y2", this.height);
    }
}

/**
 * Additional horizontal axis that is displayed on y = 0 so that it is clear
 * where this line is when the chart has a domain with y < 0 and y > 0 visible.
 */
class YZeroAxis extends Axis {
    update(t, x, y, locales, localization) {
        const yZero = nonNaN(y(0));
        this.chart.select('.axis.y0')
            .transition(t)
            .attr("opacity", yZero < 0 || yZero > this.height ? 0 : 1)
            .attr("transform", `translate(0,${yZero})`)
            .select("line")
            .attr("x2", this.width);
    }
}

/**
 * Additional diagonal line through origin dividing the chart in half so that
 * it is easier to see which portion is y < x and which is y > x when the
 * aspect ratio of the chart is not perfectly square.
 */
class YXAxis extends Axis {
    update(t, x, y, locales, localization) {
        this.chart.select('.axis.yx')
            .classed("is-invisible", !this.config)
            .transition(t)
            .select("line")
            .attr("x1", Math.max(0, nonNaN(x(y.domain()[0]))))
            .attr("x2", Math.min(this.width, nonNaN(x(y.invert(0)))))
            .attr("y1", Math.min(this.height, nonNaN(y(x.domain()[0]))))
            .attr("y2", Math.max(0, nonNaN(y(x.invert(this.width)))));
    }
}

/**
 * Area of the chart which displays features for future sprints.
 */
class FutureAxis extends Axis {
    update(t, x, y, locales, localization) {
        const future = this.chart.select('.axis.future')
            .classed("is-invisible", this.config === false);
        if (this.config !== false) {
            const first = x(this.config);
            future.transition(t)
                .select("rect")
                .attr("x", first)
                .attr("width", nonNaN(this.width - first))
                .attr("height", this.height);
        }
    }
}

// The additional axes.
const axes = {
    x0: XZeroAxis,
    y0: YZeroAxis,
    yx: YXAxis,
    future: FutureAxis
};

export {Axis, axes};
