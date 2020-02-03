// Mouse event handler for overlay

export default class Mouse {

    constructor(comp) {
        this.comp = comp
        this.map = {}
        this.listeners = 0
        this.pressed = false
        this.x = comp.$props.cursor.x
        this.y = comp.$props.cursor.y
        this.t = comp.$props.cursor.t
        this.y$ = comp.$props.cursor.y$
    }

    // You can choose where to place the handler
    // (beginning or end of the queue)
    on(name, handler, dir = 'unshift') {
        if (typeof handler !== 'function') return

        if (!this.map.hasOwnProperty(name)) {
            this.map[name] = [handler];
        } else {
            this.map[name][dir](handler)
        }

        this.listeners++
    }

    // Called by grid.js
    emit(name, event) {
        const l = this.comp.layout
        if (this.map.hasOwnProperty(name)) {
            for (const f of this.map[name]) {
                f(event)
            }
        }

        switch (name) {
            case 'mousemove':
                this.x = event.layerX
                this.y = event.layerY
                this.t = l.screen2t(this.x)
                this.y$ = l.screen2$(this.y)
                break
            case 'mousedown':
                this.pressed = true
                break
            case 'mouseup':
                this.pressed = false
                break
        }
    }

}
