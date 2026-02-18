import { NetTransform } from "./types"

export function interpTransform(a: NetTransform, b: NetTransform, t: number): NetTransform {
    return {
        id: a.id,
        p: [
            a.p[0] + (b.p[0] - a.p[0]) * t,
            a.p[1] + (b.p[1] - a.p[1]) * t,
            a.p[2] + (b.p[2] - a.p[2]) * t,
        ],
        r: a.r + (b.r - a.r) * t,
        t: a.t + (b.t - a.t) * t,
    }
}
