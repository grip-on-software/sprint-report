import _ from 'lodash';

const nonNaN = val => _.isNaN(val) ? 0 : val;

export default class Axis {
    constructor(chart, axis, config, height) {
        this.chart = chart;
        this.axis = axis;
        this.config = config;
        this.height = height;
    }

    update(t, x, y, locales, localization) {
        this.chart.select(`.axis.${this.axis}`)
            .transition(t)
            .attr("transform", this.config.transform)
            .call(this.config.axis !== null ? this.config.axis :
                node => node.selectAll('*')
                    .transition(t)
                    .style("opacity", 0)
                    .remove()
            );

        const label = this.chart.select(`.label.${this.axis}`);
        const text = this.config.label.features &&
            this.config.label.features.size === 1 ?
            locales.retrieve(localization.descriptions,
                this.config.label.features.first()
            ) : this.config.label.text;

        if (text) {
            label.text(text);
        }
        label.transition(t)
            .style("opacity", text ? 1 : 0)
            .attr("x", this.config.label.x)
            .attr("y", this.config.label.y);
    }
}

class XZeroAxis extends Axis {
    update(t, x, y, locales, localization) {
        const xZero = nonNaN(x(0));
        this.chart.select('.axis.x0')
            .transition(t)
            .attr("opacity", xZero < x.range()[0] || xZero > width ? 0 : 1)
            .attr("transform", `translate(${xZero},0)`)
            .select("line")
            .attr("y2", this.height);
    }
}

class YZeroAxis extends Axis {
    update(t, x, y, locales, localization) {
        const width = x.range()[x.range().length - 1];
        const yZero = nonNaN(y(0));
        this.chart.select('.axis.y0')
            .transition(t)
            .attr("opacity", yZero < 0 || yZero > this.height ? 0 : 1)
            .attr("transform", `translate(0,${yZero})`)
            .select("line")
            .attr("x2", width);
    }
}

class YXAxis extends Axis {
    update(t, x, y, locales, localization) {
        const width = x.range()[x.range().length - 1];
        this.chart.select('.axis.yx')
            .classed("is-invisible", !this.config)
            .transition(t)
            .select("line")
            .attr("x1", Math.max(0, nonNaN(x(y.domain()[0]))))
            .attr("x2", Math.min(width, nonNaN(x(y.invert(0)))))
            .attr("y1", Math.min(this.height, nonNaN(y(x.domain()[0]))))
            .attr("y2", Math.max(0, nonNaN(y(x.invert(width)))));
    }
}

class FutureAxis extends Axis {
    update(t, x, y, locales, localization) {
        const future = this.chart.select('.axis.future')
            .classed("is-invisible", this.config === false);
        if (this.config !== false) {
            const width = x.range()[x.range().length - 1];
            const first = x(this.config);
            future.transition(t)
                .select("rect")
                .attr("x", first)
                .attr("width", width - first)
                .attr("height", this.height);
        }
    }
}

const axes = {
    x0: XZeroAxis,
    y0: YZeroAxis,
    yx: YXAxis,
    future: FutureAxis
};

export {Axis, axes};
