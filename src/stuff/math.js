
// Math/Geometry

export default {

    // Distance from point to line
    // p1 = point, (p2, p3) = line
    point2line(p1, p2, p3) {

        const { area, base } = this.tri(p1, p2, p3)
        return Math.abs(this.tri_h(area, base))
    },

    // Distance from point to segment
    // p1 = point, (p2, p3) = segment
    point2seg(p1, p2, p3) {

        const { area, base } = this.tri(p1, p2, p3)
        // Vector projection
        const proj = this.dot_prod(p1, p2, p3) / base
        // Distance from left pin
        const l1 = Math.max(-proj, 0)
        // Distance from right pin
        const l2 = Math.max(proj - base, 0)
        // Normal
        const h = Math.abs(this.tri_h(area, base))
        return Math.max(h, l1, l2)
    },

    // Distance from point to ray
    // p1 = point, (p2, p3) = ray
    point2ray(p1, p2, p3) {

        const { area, base } = this.tri(p1, p2, p3)
        // Vector projection
        const proj = this.dot_prod(p1, p2, p3) / base
        // Distance from left pin
        const l1 = Math.max(-proj, 0)
        // Normal
        const h = Math.abs(this.tri_h(area, base))
        return Math.max(h, l1)
    },

    tri(p1, p2, p3) {
        const area = this.area(p1, p2, p3)
        const dx = p3[0] - p2[0]
        const dy = p3[1] - p2[1]
        const base = Math.sqrt(dx * dx + dy * dy)
        return { area, base }
    },

    /* Area of triangle:
            p1
          /    \
        p2  _  p3
    */
    area (p1, p2, p3) {
        return (
             p1[0] * (p2[1] - p3[1]) +
             p2[0] * (p3[1] - p1[1]) +
             p3[0] * (p1[1] - p2[1])
         )
    },

    // Triangle height
    tri_h(area, base) {
        return area / base
    },

    // Dot product of (p2, p3) and (p2, p1)
    dot_prod(p1, p2, p3) {
        const v1 = [p3[0] - p2[0], p3[1] - p2[1]]
        const v2 = [p1[0] - p2[0], p1[1] - p2[1]]
        return v1[0] * v2[0] + v1[1] * v2[1]
    }

}
