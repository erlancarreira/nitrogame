/**
 * Extrai startPositions e startRotation de um GLB com nodes nomeados do Blender.
 *
 * Convenção de nomes (coleção "Points" no Blender):
 *   GRID_LEFT_01, GRID_LEFT_02, ...   → posições de largada lado esquerdo
 *   GRID_RIGHT_01, GRID_RIGHT_02, ... → posições de largada lado direito
 *   START_LINE_CENTER                 → centro da linha de largada (para calcular startRotation)
 *
 * Uso:
 *   node scripts/extract-glb-points.mjs public/assets/kart-map/cartoon-race-track-oval/cartoon-race-track-oval.glb
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

const glbPath = process.argv[2] || 'public/assets/kart-map/cartoon-race-track-oval/cartoon-race-track-oval.glb';

const buf = readFileSync(resolve(glbPath));
const chunk0Len = buf.readUInt32LE(12);
const jsonStr = buf.slice(20, 20 + chunk0Len).toString('utf8');
const gltf = JSON.parse(jsonStr);

if (!gltf.nodes || gltf.nodes.length === 0) {
  console.error('GLB não contém nodes. Verifique o export do Blender (inclua a coleção Points).');
  process.exit(1);
}

console.log(`Total de nodes no GLB: ${gltf.nodes.length}`);
console.log('Nodes encontrados:', gltf.nodes.map(n => n.name).join(', '), '\n');

// Helpers
function getNode(name) {
  return gltf.nodes.find(n => n.name === name);
}
function getTranslation(node) {
  // glTF usa Y-up (Blender exporta com conversão automática Z-up → Y-up)
  // glTF: X=X, Y=altura, Z=profundidade
  const [x, y, z] = node.translation || [0, 0, 0];
  return { x, y, z };
}

// Coleta GRID_LEFT e GRID_RIGHT em ordem numérica
const leftNodes = gltf.nodes
  .filter(n => /^GRID_LEFT_\d+$/i.test(n.name))
  .sort((a, b) => parseInt(a.name.match(/\d+/)[0]) - parseInt(b.name.match(/\d+/)[0]));

const rightNodes = gltf.nodes
  .filter(n => /^GRID_RIGHT_\d+$/i.test(n.name))
  .sort((a, b) => parseInt(a.name.match(/\d+/)[0]) - parseInt(b.name.match(/\d+/)[0]));

const startLineNode = getNode('START_LINE_CENTER');

if (leftNodes.length === 0 && rightNodes.length === 0) {
  console.error('Nenhum node GRID_LEFT_* ou GRID_RIGHT_* encontrado.');
  console.error('Nodes disponíveis:', gltf.nodes.map(n => n.name).join(', '));
  process.exit(1);
}

console.log(`GRID_LEFT: ${leftNodes.length} nodes`);
console.log(`GRID_RIGHT: ${rightNodes.length} nodes`);
console.log(`START_LINE_CENTER: ${startLineNode ? 'encontrado' : 'NÃO encontrado'}\n`);

// Monta startPositions intercalando esquerda e direita (P1 esq, P2 dir, P3 esq, P4 dir...)
const startPositions = [];
const maxRows = Math.max(leftNodes.length, rightNodes.length);
for (let i = 0; i < maxRows; i++) {
  if (leftNodes[i]) {
    const { x, y, z } = getTranslation(leftNodes[i]);
    startPositions.push([round(x), round(y + 0.5), round(z)]); // +0.5 para não afundar no chão
  }
  if (rightNodes[i]) {
    const { x, y, z } = getTranslation(rightNodes[i]);
    startPositions.push([round(x), round(y + 0.5), round(z)]);
  }
}

// Calcula startRotation a partir do START_LINE_CENTER
// A rotação é a direção perpendicular à linha de largada (a direção que os karts encaram)
// Usamos: se temos 2 nodes de grid na mesma fileira, o vetor entre eles define a linha
// A direção de corrida é perpendicular a essa linha
let startRotation = 0;
if (startLineNode) {
  // Para calcular a direção de corrida, olhamos os primeiros dois grids (esq e dir da fileira 1)
  // e a linha de largada é perpendicular ao vetor entre eles
  if (leftNodes[0] && rightNodes[0]) {
    const l = getTranslation(leftNodes[0]);
    const r = getTranslation(rightNodes[0]);
    // Vetor da linha de largada (esq → dir)
    const lineX = r.x - l.x;
    const lineZ = r.z - l.z;
    // Direção de corrida é perpendicular: rotaciona 90° no plano XZ
    // atan2(x, z) porque Three.js usa convenção de rotação Y
    startRotation = Math.atan2(-lineZ, lineX);
    console.log(`startRotation calculado: ${startRotation.toFixed(4)} rad (${(startRotation * 180 / Math.PI).toFixed(1)}°)`);
  } else {
    const { x, z } = getTranslation(startLineNode);
    console.log(`START_LINE_CENTER em: X=${x.toFixed(2)}, Z=${z.toFixed(2)}`);
  }
}

function round(v) { return parseFloat(v.toFixed(2)); }

// Output
console.log('\n// ═══════════════════════════════════════════════');
console.log('// Cole isso no mapa "cartoon-race-track-oval" em maps.ts:');
console.log('// ═══════════════════════════════════════════════\n');

console.log('startPositions: [');
startPositions.forEach(([x, y, z], i) => {
  const comma = i < startPositions.length - 1 ? ',' : '';
  console.log(`  [${x}, ${y}, ${z}]${comma}`);
});
console.log('],');

if (startRotation !== 0) {
  // Expressa como múltiplo de PI se possível
  const ratio = startRotation / Math.PI;
  if (Math.abs(Math.round(ratio * 4) / 4 - ratio) < 0.01) {
    const frac = Math.round(ratio * 4) / 4;
    if (frac === 0.5) console.log(`startRotation: Math.PI / 2,`);
    else if (frac === -0.5) console.log(`startRotation: -Math.PI / 2,`);
    else if (frac === 1 || frac === -1) console.log(`startRotation: Math.PI,`);
    else console.log(`startRotation: Math.PI * ${frac},`);
  } else {
    console.log(`startRotation: ${startRotation.toFixed(4)},`);
  }
}
