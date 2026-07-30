import * as THREE from "three";

/**
 * Procedural Charles factory authored from assets/reference/charles/charles-concept-sheet.png
 * through the project's img2threejs intake/spec/blockout workflow.
 *
 * The returned hierarchy is deliberately articulated: shoulders, hips, head, and
 * weapon hand are stable animation pivots consumed by CharlesTrap.
 */
export type CharlesRig = {
  root: THREE.Group;
  head: THREE.Group;
  leftShoulder: THREE.Group;
  rightShoulder: THREE.Group;
  leftHip: THREE.Group;
  rightHip: THREE.Group;
  weaponHand: THREE.Group;
};

const material = (color: THREE.ColorRepresentation, roughness = 0.78, metalness = 0) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness });

function mesh(
  geometry: THREE.BufferGeometry,
  surface: THREE.Material,
  position: [number, number, number],
  scale: [number, number, number] = [1, 1, 1],
) {
  const value = new THREE.Mesh(geometry, surface);
  value.position.set(...position);
  value.scale.set(...scale);
  value.castShadow = true;
  value.receiveShadow = true;
  return value;
}

function limb(
  surface: THREE.Material,
  length: number,
  radius: number,
  position: [number, number, number],
  rotation: [number, number, number],
) {
  const pivot = new THREE.Group();
  pivot.position.set(...position);
  pivot.rotation.set(...rotation);
  pivot.add(mesh(new THREE.CapsuleGeometry(radius, length, 6, 12), surface, [0, -length * 0.42, 0]));
  return pivot;
}

export function createCharlesModel(): CharlesRig {
  const skin = material("#f3bd91", 0.84);
  const skinWarm = material("#e9a978", 0.86);
  const onesie = material("#f3ad22", 0.88);
  const onesieLight = material("#ffc64a", 0.86);
  const diaper = material("#fff4dc", 0.92);
  const ink = material("#17233d", 0.66);
  const hair = material("#6a321f", 0.82);
  const coral = material("#e9654d", 0.72);
  const yellow = material("#f6bc29", 0.76);
  const steel = material("#c9d1da", 0.3, 0.62);

  const root = new THREE.Group();
  root.name = "charles-rig";

  // The body is long on Z so Charles reads as crawling even from the game camera.
  const torso = mesh(new THREE.SphereGeometry(0.34, 20, 14), onesie, [0, 0.36, 0.05], [0.9, 0.7, 1.25]);
  torso.rotation.x = -0.18;
  root.add(torso);
  const diaperBody = mesh(new THREE.SphereGeometry(0.29, 18, 12), diaper, [0, 0.32, -0.28], [1.04, 0.78, 0.92]);
  root.add(diaperBody);
  for (const side of [-1, 1]) {
    root.add(mesh(new THREE.BoxGeometry(0.12, 0.09, 0.05), onesieLight, [side * 0.27, 0.39, -0.25], [1, 1, 1]));
  }

  const head = new THREE.Group();
  head.name = "head-pivot";
  head.position.set(0, 0.63, 0.34);
  head.rotation.x = -0.12;
  root.add(head);
  head.add(mesh(new THREE.SphereGeometry(0.34, 24, 18), skin, [0, 0, 0], [1, 1.02, 0.93]));
  head.add(mesh(new THREE.SphereGeometry(0.07, 14, 10), skinWarm, [-0.32, 0, 0], [0.62, 1, 0.72]));
  head.add(mesh(new THREE.SphereGeometry(0.07, 14, 10), skinWarm, [0.32, 0, 0], [0.62, 1, 0.72]));
  for (const side of [-1, 1]) {
    head.add(mesh(new THREE.SphereGeometry(0.055, 14, 10), ink, [side * 0.115, 0.035, 0.3], [0.66, 1.08, 0.42]));
    const brow = mesh(new THREE.BoxGeometry(0.14, 0.035, 0.035), ink, [side * 0.12, 0.155, 0.295]);
    brow.rotation.z = side * 0.31;
    head.add(brow);
  }
  head.add(mesh(new THREE.SphereGeometry(0.047, 12, 8), skinWarm, [0, -0.035, 0.335], [0.9, 0.8, 0.68]));
  const frown = mesh(new THREE.TorusGeometry(0.075, 0.015, 8, 18, Math.PI), ink, [0, -0.14, 0.326]);
  frown.rotation.set(0, 0, Math.PI);
  head.add(frown);
  const curl = mesh(new THREE.TorusGeometry(0.07, 0.025, 8, 16, Math.PI * 1.45), hair, [0.02, 0.34, 0.02]);
  curl.rotation.set(Math.PI / 2, 0.2, -0.45);
  head.add(curl);

  const leftShoulder = limb(onesie, 0.27, 0.075, [-0.28, 0.43, 0.18], [1.02, 0.05, -0.22]);
  leftShoulder.name = "left-shoulder-pivot";
  leftShoulder.add(mesh(new THREE.SphereGeometry(0.085, 12, 8), skin, [0, -0.3, 0.01], [1.25, 0.65, 1.2]));
  root.add(leftShoulder);

  const rightShoulder = limb(onesie, 0.24, 0.075, [0.28, 0.44, 0.17], [0.72, 0.08, 0.42]);
  rightShoulder.name = "right-shoulder-pivot";
  const weaponHand = new THREE.Group();
  weaponHand.name = "weapon-hand-pivot";
  weaponHand.position.set(0, -0.27, 0.01);
  rightShoulder.add(weaponHand);
  weaponHand.add(mesh(new THREE.SphereGeometry(0.09, 12, 9), skin, [0, 0, 0], [1.05, 0.78, 1]));
  const handle = mesh(new THREE.TorusGeometry(0.07, 0.024, 8, 16), coral, [0.02, -0.02, 0.015]);
  handle.rotation.x = Math.PI / 2;
  weaponHand.add(handle);
  weaponHand.add(mesh(new THREE.BoxGeometry(0.19, 0.045, 0.055), yellow, [0.02, 0.075, 0]));
  const bladeShape = new THREE.Shape();
  bladeShape.moveTo(-0.1, 0);
  bladeShape.lineTo(0.1, 0);
  bladeShape.lineTo(0, 0.32);
  bladeShape.closePath();
  const blade = mesh(new THREE.ExtrudeGeometry(bladeShape, { depth: 0.035, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.01, bevelSegments: 2 }), steel, [-0.08, 0.09, -0.02]);
  blade.rotation.z = -0.14;
  weaponHand.add(blade);
  for (let index = 0; index < 3; index += 1) {
    weaponHand.add(mesh(new THREE.SphereGeometry(0.018, 10, 8), yellow, [-0.005, 0.17 + index * 0.065, 0.025]));
  }
  root.add(rightShoulder);

  const leftHip = limb(skin, 0.25, 0.09, [-0.21, 0.32, -0.32], [0.72, 0.12, -0.35]);
  leftHip.name = "left-hip-pivot";
  leftHip.add(mesh(new THREE.SphereGeometry(0.1, 12, 8), skin, [0, -0.29, 0.02], [1.2, 0.55, 1.45]));
  root.add(leftHip);
  const rightHip = limb(skin, 0.25, 0.09, [0.21, 0.32, -0.32], [0.86, -0.08, 0.35]);
  rightHip.name = "right-hip-pivot";
  rightHip.add(mesh(new THREE.SphereGeometry(0.1, 12, 8), skin, [0, -0.29, 0.02], [1.2, 0.55, 1.45]));
  root.add(rightHip);

  const rig = { root, head, leftShoulder, rightShoulder, leftHip, rightHip, weaponHand };
  root.userData.sculptRuntime = { nodes: rig };
  root.userData.reference = "assets/reference/charles/charles-concept-sheet.png";
  root.userData.pipeline = "img2threejs";
  return rig;
}
