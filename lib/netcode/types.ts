export interface NetTransform {
    id: string
    p: [number, number, number]
    r: number
    t: number
}

export interface InputCmd {
    seq: number
    forward: boolean
    backward: boolean
    left: boolean
    right: boolean
    drift: boolean
    time: number
}

export interface Snapshot {
    time: number
    players: NetTransform[]
}
