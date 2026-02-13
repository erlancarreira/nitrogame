import { NetTransform } from "./types"

export function lerp(a: number, b: number, t: number) {
    return a + (b - a) * t
}

export function interpTransform(a: NetTransform, b: NetTransform, t: number): NetTransform {
    return {
        id: a.id,
        t: lerp(a.t, b.t, t),
        r: lerp(a.r, b.r, t),
        p: [
            lerp(a.p[0], b.p[0], t),
            lerp(a.p[1], b.p[1], t),
            lerp(a.p[2], b.p[2], t),
        ]
    }
}
