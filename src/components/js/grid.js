// Grid.js listens to various user-generated events,
// emits Vue-events if something has changed (e.g. range)
// Think of it as an I/O system for Grid.vue

import FrameAnimation from '../../stuff/frame.js'
import * as Hammer from 'hammerjs'
import Hamster from 'hamsterjs'
import Utils from '../../stuff/utils.js'
import math from '../../stuff/math.js'

// Grid is good.
//
// TODO: currently we emit multiple 'cursor-locked' events,
// eg one when we click, second when we start paning; might be ok, just something to... review perhaps
export default class Grid {

    constructor(canvas, comp) {

        this.MIN_ZOOM = comp.config.MIN_ZOOM
        this.MAX_ZOOM = comp.config.MAX_ZOOM

        if (Utils.is_mobile) this.MIN_ZOOM *= 0.5

        this.canvas = canvas
        this.ctx = canvas.getContext('2d')
        this.comp = comp
        this.$p = comp.$props
        this.data = this.$p.sub
        this.range = this.$p.range
        this.id = this.$p.grid_id
        this.layout = this.$p.layout.grids[this.id]
        this.interval = this.$p.interval
        this.cursor = comp.$props.cursor
        this.offset_x = 0
        this.offset_y = 0
        this.deltas = 0 // Wheel delta events
        this.wmode = this.$p.config.SCROLL_WHEEL
        this.drag = null;
        this.pinch = null;

        this.listeners()
        this.overlays = []
    }

    listeners() {

        this.hm = Hamster(this.canvas)
        this.hm.wheel((event, delta) => this.mousezoom(-delta * 50, event))

        let mc = this.mc = new Hammer.Manager(this.canvas)
        let T = Utils.is_mobile ? 10 : 0
        mc.add(new Hammer.Pan({ threshold: T}))
        mc.add(new Hammer.Tap())
        mc.add(new Hammer.Pinch({ threshold: 0}))
        mc.get('pinch').set({ enable: true })
        if (Utils.is_mobile) mc.add(new Hammer.Press())

        mc.on('panstart', event => {
            if (this.cursor.scroll_lock) return
            if (this.cursor.mode === 'aim') {
                return this.emit_cursor_coord(event)
            }
            let tfrm = this.$p.y_transform
            this.drag = {
                x: event.center.x + this.offset_x,
                y: event.center.y + this.offset_y,
                r: Object.assign({}, this.range),
                o: tfrm ?
                    (tfrm.offset || 0) : 0,
                y_r: tfrm && tfrm.range ?
                    Object.assign({}, tfrm.range) : undefined,
                B: this.layout.B,
                t0: Utils.now(),
                compound: 0,  // compounding tally of our x-axis movement from the position where panstart stared from
            }
            this.comp.$emit('cursor-changed', {
                grid_id: this.id,
                x: event.center.x + this.offset_x,
                y: event.center.y + this.offset_y
            })
            this.comp.$emit('cursor-locked', true)
        })

        mc.on('panmove', event => {
            if (Utils.is_mobile) {
                this.calc_offset()
                this.propagate('mousemove', this.touch2mouse(event))
            }
            if (this.drag !== null) {
                this.mousedrag(
                    this.drag.x + event.deltaX,
                    this.drag.y + event.deltaY,
                )
                this.comp.$emit('cursor-changed', {
                    grid_id: this.id,
                    x: event.center.x + this.offset_x,
                    y: event.center.y + this.offset_y
                })
            } else if (this.cursor.mode === 'aim') {
                this.emit_cursor_coord(event)
            }
        })

        mc.on('panend', event => {
            if (Utils.is_mobile && this.drag) {
                this.pan_fade(event)
            }
            this.drag = null
            this.comp.$emit('cursor-locked', false)
        })

        mc.on('tap', event => {
            if (!Utils.is_mobile) return
            this.sim_mousedown(event)
            if (this.fade) this.fade.stop()
            this.comp.$emit('cursor-changed', {})
            this.comp.$emit('cursor-changed', {
                /*grid_id: this.id,
                x: undefined,//event.center.x + this.offset_x,
                y: undefined,//event.center.y + this.offset_y,*/
                mode: 'explore'
            })
            this.update()
        })

        mc.on('pinchstart', () => {
            this.drag = null
            this.pinch = {
                t: this.range.delta,
            }
        })

        mc.on('pinchend', () => {
            this.pinch = null
        })

        mc.on('pinch', event => {
            if (this.pinch !== null) this.pinchzoom(event.scale)
        })

        mc.on('press', event => {
            if (!Utils.is_mobile) return
            if (this.fade) this.fade.stop()
            this.calc_offset()
            this.emit_cursor_coord(event, { mode: 'aim' })
            setTimeout(() => this.update())
            this.sim_mousedown(event)
        })

        let add = addEventListener
        add("gesturestart", this.gesturestart)
        add("gesturechange", this.gesturechange)
        add("gestureend", this.gestureend)

    }

    gesturestart(event) { event.preventDefault() }
    gesturechange(event) { event.preventDefault() }
    gestureend(event) { event.preventDefault() }

    mousemove(event) {
        if (Utils.is_mobile) return
        this.comp.$emit('cursor-changed', {
            grid_id: this.id,
            x: event.layerX,
            y: event.layerY + this.layout.offset
        })
        this.calc_offset()
        this.propagate('mousemove', event)
    }

    mouseout(event) {
        if (Utils.is_mobile) return
        this.comp.$emit('cursor-changed', {})
        this.propagate('mouseout', event)
    }

    mouseup(event) {
        this.drag = null
        //this.pinch = null

        this.comp.$emit('cursor-locked', false)
        this.propagate('mouseup', event)
    }

    mousedown(event) {
        if (Utils.is_mobile) return
        this.propagate('mousedown', event)
        this.comp.$emit('cursor-locked', true)
        if (event.defaultPrevented) return
        this.comp.$emit('custom-event', {
            event: 'grid-mousedown', args: [this.id, event]
        })
    }

    // Simulated mousedown (for mobile)
    sim_mousedown(event) {
        if (event.srcEvent.defaultPrevented) return
        this.comp.$emit('custom-event', {
            event: 'grid-mousedown',
            args: [this.id, event]
        })
        this.propagate('mousemove', this.touch2mouse(event))
        this.update()
        this.propagate('mousedown', this.touch2mouse(event))
        setTimeout(() => {
            this.propagate('click', this.touch2mouse(event))
        })
    }

    // Convert touch to "mouse" event
    touch2mouse(e) {
        this.calc_offset()
        return {
            original: e.srcEvent,
            layerX: e.center.x + this.offset_x,
            layerY: e.center.y + this.offset_y,
            preventDefault: function() {
                this.original.preventDefault()
            }
        }
    }

    click(event) {
        this.propagate('click', event)
    }

    emit_cursor_coord(event, add = {}) {
        this.comp.$emit('cursor-changed', Object.assign({
            grid_id: this.id,
            x: event.center.x + this.offset_x,
            y: event.center.y + this.offset_y + this.layout.offset
        }, add))
    }

    pan_fade(event) {
        let dt = Utils.now() - this.drag.t0
        let dx = this.range[1] - this.drag.r[1]
        let v = 42 * dx / dt
        let v0 = Math.abs(v * 0.01)
        if (dt > 500) return
        if (this.fade) this.fade.stop()
        this.fade = new FrameAnimation(self => {
            v *= 0.85
            if (Math.abs(v) < v0) {
                self.stop()
            }
            this.range[0] += v
            this.range[1] += v
            this.change_range()
        })
    }

    calc_offset() {
        let rect = this.canvas.getBoundingClientRect()
        this.offset_x = -rect.x
        this.offset_y = -rect.y
    }

    new_layer(layer) {
        if (layer.name === 'crosshair') {
            this.crosshair = layer
        } else {
            this.overlays.push(layer)
        }
        this.update()
    }

    del_layer(id) {
        this.overlays = this.overlays.filter(x => x.id !== id)
        this.update()
    }

    show_hide_layer(event) {
        const l = this.overlays.filter(x => x.id === event.id)
        if (l.length) l[0].display = event.display
    }

    update() {
        // Update reference to the grid
        // TODO: check what happens if data changes interval
        this.layout = this.$p.layout.grids[this.id]
        this.interval = this.$p.interval

        if (!this.layout) return

        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
        if (this.$p.shaders.length) this.apply_shaders()

        this.grid()

        this.overlays.slice(0)  // copy
            .sort((l1, l2) => l1.z - l2.z)  // z-index sorting
            .forEach(l => {
                if (!l.display) return
                this.ctx.save()
                const r = l.renderer
                if (r.hasOwnProperty('pre_draw') && typeof r.pre_draw === 'function') r.pre_draw(this.ctx)
                r.draw(this.ctx)
                if (r.hasOwnProperty('post_draw') && typeof r.post_draw === 'function') r.post_draw(this.ctx)
                this.ctx.restore()
            })

        if (this.crosshair) {
            this.crosshair.renderer.draw(this.ctx)
        }
    }

    apply_shaders() {
        let layout = this.$p.layout.grids[this.id]
        let props = {
            layout: layout,
            range: this.range,
            interval: this.interval,
            tf: layout.ti_map.tf,
            cursor: this.cursor,
            colors: this.$p.colors,
            sub: this.data,
            font: this.$p.font,
            config: this.$p.config,
            meta: this.$p.meta
        }
        for (var s of this.$p.shaders) {
            this.ctx.save()
            s.draw(this.ctx, props)
            this.ctx.restore()
        }
    }

    // Actually draws the grid (for real)
    grid() {

        this.ctx.strokeStyle = this.$p.colors.grid
        this.ctx.beginPath()

        const ymax = this.layout.height
        for (const [x, p] of this.layout.xs) {

            this.ctx.moveTo(x - 0.5, 0)
            this.ctx.lineTo(x - 0.5, ymax)
        }

        for (const [y, y$] of this.layout.ys) {

            this.ctx.moveTo(0, y - 0.5)
            this.ctx.lineTo(this.layout.width, y - 0.5)
        }

        this.ctx.stroke()
        if (this.$p.grid_id) this.upper_border()
    }

    upper_border() {
        this.ctx.strokeStyle = this.$p.colors.scale
        this.ctx.beginPath()
        this.ctx.moveTo(0, 0.5)
        this.ctx.lineTo(this.layout.width, 0.5)
        this.ctx.stroke()
    }

    mousezoom(delta, event) {

        // TODO: for mobile
        if (this.wmode !== 'pass') {
            if (this.wmode === 'click' && !this.$p.meta.activated) {
                return
            }
            event.originalEvent.preventDefault()
            event.preventDefault()
        }

        event.deltaX = event.deltaX || Utils.get_deltaX(event)
        event.deltaY = event.deltaY || Utils.get_deltaY(event)

        if (event.deltaX !== 0) {
            this.trackpad = true
            if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) {
                delta *= 0.1
            }
            this.trackpad_scroll(event)
        }

        if (this.trackpad) delta *= 0.032

        delta = Utils.smart_wheel(delta)

        // TODO: mouse zooming is a little jerky,
        // needs to follow f(mouse_wheel_speed) and
        // if speed is low, scroll should be slower
        if (delta < 0 && this.data.length <= this.MIN_ZOOM) return
        if (delta > 0 && this.data.length > this.MAX_ZOOM) return
        const k = this.interval / 1000
        let diff = delta * k * this.data.length
        let tl = this.comp.config.ZOOM_MODE === 'tl'
        if (event.originalEvent.ctrlKey || tl) {
            let offset = event.originalEvent.offsetX
            let diff_x = offset / (this.canvas.width-1) * diff
            let diff_y = diff - diff_x
            this.change_range(-diff_x, diff_y)
        } else {
            this.change_range(-diff)
        }

        // TODO: this is added in upstream... unsure if needed for us:
        /*
        if (tl) {
            let offset = event.originalEvent.offsetY
            let diff1 = offset / (this.canvas.height-1) * 2
            let diff2 = 2 - diff1
            let z = diff / (this.range[1] - this.range[0])
            //rezoom_range(z, diff_x, diff_y)
            this.comp.$emit('rezoom-range', {
                grid_id: this.id, z, diff1, diff2
            })
        }

        this.change_range() */
    }

    /**
     * Call w/ updated coords
     * @param x new!
     * @param y new!
     */
    mousedrag(x, y) {

        const ls = !!this.layout.grid.logScale
        let range = null

            let d$ = this.layout.$_hi - this.layout.$_lo
            d$ *= (this.drag.y - y) / this.layout.height
            const offset = this.drag.o + d$

        let ls = this.layout.grid.logScale

        if (ls && this.drag.y_r) {
            let dy = this.drag.y - y
            var range = this.drag.y_r.slice()
            range[0] = math.exp((0 - this.drag.B + dy) /
                this.layout.A)
            range[1] = math.exp(
                (this.layout.height - this.drag.B + dy) /
                this.layout.A)
        }

        if (this.drag.y_r && this.$p.y_transform &&
            !this.$p.y_transform.auto) {
            this.comp.$emit('sidebar-transform', {
                grid_id: this.id,
                range: ls ? (range || this.drag.y_r) : [
                    this.drag.y_r[0] - offset,
                    this.drag.y_r[1] - offset,
                ]
            })
        }

        const dt_from_starting_position = this.drag.r.delta * (this.drag.x - x) / this.layout.width
        const dx = dt_from_starting_position - this.drag.compound
        this.change_range(dx, dx)
        this.drag.compound = dt_from_starting_position
    }

    pinchzoom(scale) {

        if (scale > 1 && this.data.length <= this.MIN_ZOOM) return
        if (scale < 1 && this.data.length > this.MAX_ZOOM) return

        const t = this.pinch.t
        const nt = t * 1 / scale

        const dt = (nt - t) * 0.5
        this.change_range(-dt, dt)
    }

    trackpad_scroll(event) {

        const dt = event.deltaX * this.range.delta * 0.011
        this.change_range(dt, dt)
    }

    change_range(start_diff, end_diff = 0) {

        // TODO: better way to limit the view. Problem:
        // when you are at the dead end of the data,
        // and keep scrolling,
        // the chart continues to scale down a little.
        // Solution: I don't know yet


        if (!this.range || this.data.length < 2) return

        // TODO: where to do the clamping? in utils?
        //start_diff = Utils.clamp(
            //    start_diff,
        //-Infinity,
        //   this.data[l][0] - this.interval * 5.5,
        // )

        //end_diff = Utils.clamp(
        //    end_diff,
        //    this.data[0][0] + this.interval * 5.5,
        //   Infinity
        //)


        // TODO: IMPORTANT scrolling is jerky The Problem caused
        // by the long round trip of 'range-changed' event.
        // First it propagates up to update layout in Chart.vue,
        // then it moves back as watch() update. It takes 1-5 ms.
        // And because the delay is different each time we see
        // the lag. No smooth movement and it's annoying.
        // Solution: we could try to calc the layout immediatly
        // somewhere here. Still will hurt the sidebar & bottombar
        this.comp.$emit('movement', [Math.round(start_diff), Math.round(end_diff)])
    }

    // Propagate mouse event to overlays
    propagate(name, event) {
        for (const layer of this.overlays) {
            if (layer.renderer.hasOwnProperty(name) && typeof layer.renderer[name] === 'function') {
                layer.renderer[name](event)
            }

            const mouse = layer.renderer.mouse
            if (mouse.listeners) {
                mouse.emit(name, event)
            }

            const keys = layer.renderer.keys
            if (keys && keys.listeners) {
                keys.emit(name, event)
            }
        }
    }

    destroy() {
        let rm = removeEventListener
        rm("gesturestart", this.gesturestart)
        rm("gesturechange", this.gesturechange)
        rm("gestureend", this.gestureend)
        if (this.mc) this.mc.destroy()
        if (this.hm) this.hm.unwheel()
    }
}
