(() => {
  'use strict';
  const canvas = document.querySelector('#model-webgl');
  const surface = document.querySelector('.model-gesture');
  const group = document.querySelector('#model-canvas');
  const status = document.querySelector('.model-fallback');
  const buttons = [...document.querySelectorAll('.view-button')];
  const slider = document.querySelector('.depth-control input');
  const output = document.querySelector('.depth-control output');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const listeners = [], resources = new Set();
  let disposed = false, visible = true, orbit = false, drag = null, raf = 0, last = 0, dirty = true;
  let yaw = .58, pitch = .12, scale = 1, distance = 6, renderer;
  const home = { yaw: .58, pitch: .12 };
  const on = (target, type, callback, options) => {
    target.addEventListener(type, callback, options);
    listeners.push(() => target.removeEventListener(type, callback, options));
  };
  const keep = item => { resources.add(item); return item; };
  const active = name => buttons.forEach(button => {
    button.classList.toggle('active', button.dataset.view === name);
    if (button.dataset.view === 'auto') button.setAttribute('aria-pressed', String(orbit));
  });
  const stopOrbit = () => { orbit = false; active(''); dirty = true; const button = document.querySelector('[data-view="auto"]'); if (button) button.textContent = '环绕'; };
  window.aerisViewer = { stopOrbit };
  try {
    if (!window.THREE) throw new Error('三维渲染引擎未加载');
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.45;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, .1, 100);
    const model = new THREE.Group();
    scene.add(model);
    const hemi = new THREE.HemisphereLight(0xd9f5ff, 0x182235, 2.6);
    scene.add(hemi);
    const light = (color, intensity, x, y, z) => {
      const l = new THREE.DirectionalLight(color, intensity); l.position.set(x, y, z); scene.add(l);
    };
    light(0xffffff, 4.4, 4, 6, 5);
    light(0x91dfff, 3.6, -5, 1, -3);
    light(0xffffff, 2.5, 1, -2, -5);
    // A generated studio environment gives metal real reflections from all directions.
    const studio = new THREE.Scene();
    studio.background = new THREE.Color(0x536172);
    [[-4, 3, 0], [4, 1, 1], [0, 5, -2]].forEach((p, i) => {
      const card = new THREE.Mesh(keep(new THREE.PlaneGeometry(5, 8)),
        keep(new THREE.MeshBasicMaterial({ color: i === 1 ? 0x98cbdc : 0xffffff, side: THREE.DoubleSide })));
      card.position.set(...p); card.lookAt(0, 0, 0); studio.add(card);
    });
    const pmrem = new THREE.PMREMGenerator(renderer);
    const environment = pmrem.fromScene(studio, .08, .1, 30);
    scene.environment = environment.texture;
    pmrem.dispose();
    const textureCanvas = document.createElement('canvas');
    textureCanvas.width = textureCanvas.height = 128;
    const ctx = textureCanvas.getContext('2d');
    const pixels = ctx.createImageData(128, 128);
    let seed = 211;
    for (let i = 0; i < pixels.data.length; i += 4) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const n = 90 + (seed >>> 26);
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = n; pixels.data[i + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0);
    const grain = keep(new THREE.CanvasTexture(textureCanvas));
    grain.wrapS = grain.wrapT = THREE.RepeatWrapping; grain.repeat.set(5, 5);
    const metal = keep(new THREE.MeshStandardMaterial({ color: 0x252d35, metalness: .80, roughness: .38 }));
    const edge = keep(new THREE.MeshStandardMaterial({ color: 0x758390, metalness: .95, roughness: .22 }));
    const dark = keep(new THREE.MeshStandardMaterial({ color: 0x090c10, metalness: .3, roughness: .5 }));
    const leather = keep(new THREE.MeshStandardMaterial({ color: 0x11141a, roughness: .83, metalness: .05, bumpMap: grain, bumpScale: .025 }));
    const cyan = keep(new THREE.MeshStandardMaterial({ color: 0x86e5f2, emissive: 0x36c4e7, emissiveIntensity: 1.7, metalness: .4, roughness: .25 }));
    const fabric = keep(new THREE.MeshStandardMaterial({ color: 0x111720, roughness: 1, bumpMap: grain, bumpScale: .018 }));
    function mesh(geometry, material, parent, x = 0, y = 0, z = 0) {
      const item = new THREE.Mesh(keep(geometry), material); item.position.set(x, y, z); parent.add(item); return item;
    }
    function rounded(w, h, r, path = new THREE.Shape()) {
      const x = -w / 2, y = -h / 2;
      path.moveTo(x + r, y); path.lineTo(x + w - r, y);
      path.quadraticCurveTo(x + w, y, x + w, y + r); path.lineTo(x + w, y + h - r);
      path.quadraticCurveTo(x + w, y + h, x + w - r, y + h); path.lineTo(x + r, y + h);
      path.quadraticCurveTo(x, y + h, x, y + h - r); path.lineTo(x, y + r);
      path.quadraticCurveTo(x, y, x + r, y); return path;
    }
    function plate(w, h, depth, radius, material, parent, z, hole = false) {
      const shape = rounded(w, h, radius);
      if (hole) shape.holes.push(rounded(w * .61, h * .67, radius * .58, new THREE.Path()));
      const geo = new THREE.ExtrudeGeometry(shape, {
        depth, bevelEnabled: true, bevelSegments: 4, steps: 1,
        bevelSize: .035, bevelThickness: .035, curveSegments: 16
      });
      return mesh(geo, material, parent, 0, 0, z);
    }
    class BandCurve extends THREE.Curve {
      constructor(radius, y) { super(); this.radius = radius; this.y = y; }
      getPoint(t, target = new THREE.Vector3()) {
        const angle = Math.PI * t;
        return target.set(Math.cos(angle) * this.radius, Math.sin(angle) * this.radius + this.y, 0);
      }
    }
    const bandProfile = rounded(.17, .43, .075);
    mesh(new THREE.ExtrudeGeometry(bandProfile, {
      steps: 96, bevelEnabled: false, extrudePath: new BandCurve(1.34, .22)
    }), metal, model);
    const paddingProfile = rounded(.17, .35, .075);
    mesh(new THREE.ExtrudeGeometry(paddingProfile, {
      steps: 96, bevelEnabled: false, extrudePath: new BandCurve(1.08, .22)
    }), leather, model);
    [-.18, .18].forEach(z => {
      const seam = mesh(new THREE.TubeGeometry(new BandCurve(1.36, .22), 96, .014, 8, false), edge, model);
      seam.position.z = z;
    });
    const earcups = [];
    [-1, 1].forEach(side => {
      const cup = new THREE.Group();
      cup.position.set(side * 1.23, -.65, 0); cup.rotation.y = side * Math.PI / 2;
      cup.rotation.z = side * -.08;
      model.add(cup); earcups.push(cup); cup.userData.part = side === 1 ? 'controls' : 'driver';
      plate(1.05, 1.75, .24, .38, metal, cup, -.10);
      plate(1.08, 1.77, .045, .4, edge, cup, .13);
      plate(1.04, 1.73, .095, .38, dark, cup, .19);
      plate(.96, 1.61, .045, .34, metal, cup, .30);
      plate(1.05, 1.76, .15, .4, leather, cup, -.30, true);
      plate(.73, 1.26, .025, .28, fabric, cup, -.12);
      const driver = mesh(new THREE.CircleGeometry(.28, 48), fabric, cup, 0, -.03, -.135);
      driver.rotation.y = Math.PI;
      const perforations = new THREE.InstancedMesh(keep(new THREE.SphereGeometry(.009, 6, 4)), dark, 171);
      const transform = new THREE.Object3D(); let idx = 0;
      for (let row = -9; row <= 9; row++) for (let col = -4; col <= 4; col++) {
        transform.position.set(col * .055, row * .052, -.151); transform.updateMatrix();
        perforations.setMatrixAt(idx++, transform.matrix);
      }
      cup.add(perforations);
      [-.32, .32].forEach(x => [-.59, .59].forEach(y => {
        mesh(new THREE.CylinderGeometry(.032, .032, .014, 16), edge, cup, x, y, .373).rotation.x = Math.PI / 2;
        mesh(new THREE.BoxGeometry(.035, .006, .008), dark, cup, x, y, .383);
      }));
      [-1, 1].forEach(s => {
        const led = mesh(new THREE.BoxGeometry(.028, .39, .014), cyan, cup, s * .41, -.08, .39);
        led.rotation.z = s * .05;
      });
      for (let i = 0; i < 6; i++) {
        mesh(new THREE.BoxGeometry(.14, .018, .012), dark, cup, .22, .28 + i * .045, .39);
      }
      const stem = mesh(new THREE.CylinderGeometry(.043, .043, .60, 16), edge, model, side * 1.34, -.03, 0);
      const hinge = mesh(new THREE.CylinderGeometry(.12, .12, .11, 32), edge, model, side * 1.34, -.28, .03);
      hinge.rotation.x = Math.PI / 2;
      mesh(new THREE.CylinderGeometry(.076, .076, .12, 32), dark, model, side * 1.34, -.28, .045).rotation.x = Math.PI / 2;
      if (side === 1) {
        mesh(new THREE.CylinderGeometry(.11, .11, .07, 48), edge, cup, .21, -.49, .39).rotation.x = Math.PI / 2;
        mesh(new THREE.CylinderGeometry(.075, .075, .076, 32), dark, cup, .21, -.49, .395).rotation.x = Math.PI / 2;
        const port = mesh(new THREE.BoxGeometry(.16, .06, .02), dark, cup, -.10, -.65, .37);
      }
    });
    // Badge is a small label on a real 3D face; the product itself is all mesh geometry.
    const labelCanvas = document.createElement('canvas'); labelCanvas.width = 256; labelCanvas.height = 128;
    const labelCtx = labelCanvas.getContext('2d');
    labelCtx.fillStyle = '#b8d8e5'; labelCtx.font = '500 38px Arial'; labelCtx.textAlign = 'center';
    labelCtx.fillText('A E R I S', 128, 52); labelCtx.font = '18px Arial'; labelCtx.fillStyle = '#677d8b';
    labelCtx.fillText('ONE / SPATIAL AUDIO', 128, 87);
    const labelTexture = keep(new THREE.CanvasTexture(labelCanvas)); labelTexture.colorSpace = THREE.SRGBColorSpace;
    const labelMaterial = keep(new THREE.MeshBasicMaterial({ map: labelTexture, transparent: true, depthWrite: false }));
    earcups.forEach(cup => mesh(new THREE.PlaneGeometry(.67, .33), labelMaterial, cup, 0, .06, .384));
    const bbox = new THREE.Box3().setFromObject(model);
    const center = bbox.getCenter(new THREE.Vector3());
    model.position.sub(center);
    const dimensions = bbox.getSize(new THREE.Vector3());
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const insight = document.querySelector('.model-insight');
    let insightTimer = 0;
    const descriptions = {
      band: ['头梁结构', '金属外梁与内侧柔软衬垫。拖动查看完整的弧面和侧边。'],
      driver: ['耳罩内腔', '独立耳垫、织物内网与腔体。旋转可查看内外结构。'],
      controls: ['耳罩控制区', '实体旋钮、接口、紧固件与金属外壳。点击背面查看另一侧。']
    };
    function inspect(event) {
      const rect = canvas.getBoundingClientRect();
      mouse.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
      raycaster.setFromCamera(mouse, camera);
      const hit = raycaster.intersectObject(model, true)[0];
      if (!hit) { insight.classList.remove('visible'); return; }
      let node = hit.object;
      while (node && !node.userData.part) node = node.parent;
      const [title, copy] = descriptions[node?.userData.part || 'band'];
      insight.querySelector('strong').textContent = title;
      insight.querySelector('span').textContent = copy;
      insight.classList.add('visible'); clearTimeout(insightTimer);
      insightTimer = setTimeout(() => insight.classList.remove('visible'), 4500);
    }
    let width = 0, height = 0;
    function resize() {
      const box = group.getBoundingClientRect();
      width = Math.max(1, box.width); height = Math.max(1, box.height);
      camera.aspect = width / height; camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      const v = THREE.MathUtils.degToRad(camera.fov);
      // Reserve room for the controls and fit the widest model pose at default zoom.
      distance = Math.max(dimensions.y / (2 * Math.tan(v / 2) * .72),
        dimensions.x / (2 * Math.tan(v / 2) * camera.aspect * .85));
      dirty = true;
    }
    function render() {
      const r = distance / scale, c = Math.cos(pitch);
      camera.position.set(r * Math.sin(yaw) * c, r * Math.sin(pitch), r * Math.cos(yaw) * c);
      camera.lookAt(0, 0, 0); renderer.render(scene, camera);
      group.dataset.yaw = yaw.toFixed(3); group.dataset.pitch = pitch.toFixed(3);
      group.dataset.zoom = scale.toFixed(2); group.dataset.triangles = renderer.info.render.triangles;
      dirty = false;
    }
    function tick(time) {
      if (disposed) return;
      const dt = Math.min((time - last) / 1000 || 0, .05); last = time;
      if (visible && !document.hidden) {
        if (orbit) { yaw += dt * .35; dirty = true; }
        if (dirty) render();
      }
      raf = requestAnimationFrame(tick);
    }
    function reset() {
      stopOrbit(); yaw = home.yaw; pitch = home.pitch; scale = 1;
      slider.value = '100'; output.value = '100%'; active('reset'); dirty = true; insight.classList.remove('visible');
    }
    buttons.forEach(button => on(button, 'click', () => {
      if (button.dataset.view === 'reset') reset();
      if (button.dataset.view === 'auto') {
        orbit = !orbit; active(orbit ? 'auto' : '');
        button.textContent = orbit ? '暂停' : '环绕';
      }
      if (button.dataset.view === 'back') {
        stopOrbit(); yaw = home.yaw + Math.PI; pitch = home.pitch; dirty = true; active('back');
      }
    }));
    on(slider, 'input', () => { stopOrbit(); scale = Number(slider.value) / 100; output.value = slider.value + '%'; dirty = true; });
    on(surface, 'pointerdown', event => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      stopOrbit(); document.querySelector('[data-view="auto"]').textContent = '环绕';
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: false, touch: event.pointerType === 'touch' };
      surface.setPointerCapture(event.pointerId); group.focus({ preventScroll: true });
    });
    on(surface, 'pointermove', event => {
      if (!drag || drag.id !== event.pointerId) return;
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 6) drag.moved = true;
      yaw -= (event.clientX - drag.x) * .009;
      if (!drag.touch) pitch = THREE.MathUtils.clamp(pitch + (event.clientY - drag.y) * .006, -1.2, 1.2);
      drag.x = event.clientX; drag.y = event.clientY; dirty = true;
    });
    const release = event => { const clicked = drag && !drag.moved && event.type === 'pointerup'; if (surface.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId); drag = null; if (clicked) inspect(event); };
    on(surface, 'pointerup', release); on(surface, 'pointercancel', release);
    on(surface, 'lostpointercapture', () => { drag = null; });
    on(group, 'keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return;
      event.preventDefault(); stopOrbit();
      if (event.key === 'Home') reset();
      if (event.key === 'ArrowLeft') yaw += .15;
      if (event.key === 'ArrowRight') yaw -= .15;
      if (event.key === 'ArrowUp') pitch = Math.min(1.2, pitch + .1);
      if (event.key === 'ArrowDown') pitch = Math.max(-1.2, pitch - .1);
      dirty = true;
    });
    on(reduced, 'change', stopOrbit);
    on(document, 'visibilitychange', () => { if (document.hidden) stopOrbit(); });
    // Product finish controls update the actual 3D materials.
    document.querySelectorAll('.swatch').forEach(button => on(button, 'click', () => {
      const color = getComputedStyle(document.body).getPropertyValue('--accent').trim();
      try { cyan.color.set(color); cyan.emissive.set(color); dirty = true; } catch (_) {}
    }));
    const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(group);
    const intersection = new IntersectionObserver(entries => {
      visible = entries[0].isIntersecting; if (!visible) stopOrbit(); else dirty = true;
    }); intersection.observe(group);
    on(canvas, 'webglcontextlost', event => {
      event.preventDefault(); status.textContent = '三维画面已暂停，正在恢复…'; document.body.classList.remove('model-ready');
    });
    on(canvas, 'webglcontextrestored', () => { dirty = true; document.body.classList.add('model-ready'); });
    resize(); render(); reset();
    group.dataset.viewerState = 'ready';
    group.setAttribute('aria-label', '真实三维耳机：拖拽或方向键旋转，Home复位；触屏横拖旋转，竖滑浏览页面');
    document.body.classList.add('model-ready');
    raf = requestAnimationFrame(tick);
    on(window, 'pagehide', () => {
      disposed = true; cancelAnimationFrame(raf); clearTimeout(insightTimer);
      resizeObserver.disconnect(); intersection.disconnect();
      listeners.splice(0).forEach(remove => remove());
      resources.forEach(resource => resource.dispose()); environment.dispose(); renderer.dispose();
    }, { once: true });
  } catch (error) {
    status.textContent = '无法启动三维渲染：' + error.message;
    group.dataset.viewerState = 'error';
    buttons.forEach(button => button.disabled = true); slider.disabled = true;
    console.error(error);
  }
})();
