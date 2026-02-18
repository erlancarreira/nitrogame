import { CIRCUIT_TILES } from "@/lib/game/tiles"


const TILE_SIZE = 20

export function TileTrack(){
  return (
    <>
      {CIRCUIT_TILES.map((t,i)=>(
        <mesh
          key={i}
          position={[
            t.gx*TILE_SIZE,
            0,
            t.gz*TILE_SIZE
          ]}
          rotation={[0,0,0]}
        >
          <boxGeometry args={[TILE_SIZE,0.1,TILE_SIZE]} />
          <meshStandardMaterial color="gray"/>
        </mesh>
      ))}
    </>
  )
}
