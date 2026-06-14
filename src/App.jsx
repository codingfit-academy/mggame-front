import { useState, useEffect, useRef, useCallback } from 'react';

const GAME_WIDTH = 400;
const GAME_HEIGHT = 600;
const PLAYER_SIZE = 40;
const BIRD_SIZE = 40;
const ALIEN_SIZE = PLAYER_SIZE + 12;
const ALIEN_SPAWN_RATE = 5000; // ms (spawn less often)
const HITBOX_MARGIN = 12; // 여유 있는 히트박스
const COIN_PICKUP_RANGE = 28; // 코인 자석 범위(픽셀): 클수록 더 멀리서 흡수
const SHIELD_SIZE = 36;
const SHIELD_DURATION = 10000; // 10초 무적
const SHIELD_SPAWN_CHANCE = 1.0; // 150점 도달 시 등장 확률
const MISSILE_WIDTH = 6;
const MISSILE_HEIGHT = 18;
const MISSILE_SPEED = 14;
const PUNCH_AREA_RATIO = 1.4;       // 손 면적이 1.8배 이상으로 커지면 펀치로 판정
const PUNCH_MIN_AREA = 0.012;       // 노이즈 방지: 손이 최소 이만큼은 화면을 차지해야 함
const PUNCH_COOLDOWN_MS = 350;      // 연사 방지(이 시간 내 재발사 금지)
const PUNCH_WINDOW_MS = 300;        // 면적 변화를 비교할 시간 윈도우
const PLAYER_Y = GAME_HEIGHT - PLAYER_SIZE - 20;

const GAME_STATES = {
  START: 'START',
  PLAYING: 'PLAYING',
  PAUSED: 'PAUSED',
  GAME_OVER: 'GAME_OVER',
};

export default function App() {
  const [gameState, setGameState] = useState(GAME_STATES.START);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(5);
  const [isDamaged, setIsDamaged] = useState(false);
  const [isExploding, setIsExploding] = useState(false);
  const [coins, setCoins] = useState(0);
  const [shieldSecondsLeft, setShieldSecondsLeft] = useState(0);
  const [cameraStatus, setCameraStatus] = useState('off'); // 'off' | 'requesting' | 'on' | 'error'

  const requestRef = useRef();
  const lastTimeRef = useRef();

  const playerXRef = useRef(GAME_WIDTH / 2 - PLAYER_SIZE / 2);
  const collisionXRef = useRef(GAME_WIDTH / 2 - PLAYER_SIZE / 2);
  const birdsRef = useRef([]);
  const aliensRef = useRef([]);
  const coinsRef = useRef([]);
  const shieldsRef = useRef([]);
  const alienSpawnRef = useRef({ lastSpawn: 0, spawnRate: ALIEN_SPAWN_RATE });
  const lastAlienSpawnScoreRef = useRef(0);
  const lastCoinSpawnScoreRef = useRef(0);
  const lastShieldSpawnScoreRef = useRef(0);
  const invincibleUntilRef = useRef(0);
  const shieldSecondsLeftRef = useRef(0);
  const coinShowerRef = useRef({ active: false, rowsRemaining: 0, nextSpawnTime: 0 });
  const coinShowerTriggeredRef = useRef(false);
  const pauseStartedAtRef = useRef(0);
  // 웹캠 조작(얼굴 추적 + 주먹 펀치)
  const videoElRef = useRef(null);
  const previewCanvasRef = useRef(null);
  const faceDetectorRef = useRef(null);
  const handDetectorRef = useRef(null);
  const handAreaHistoryRef = useRef([]); // {time, area}
  const lastFireTimeRef = useRef(0);
  const cameraXRef = useRef(null);
  const cameraEnabledRef = useRef(false);
  const cameraRafRef = useRef(null);
  const missilesRef = useRef([]);
  const gameStateRef = useRef(GAME_STATES.START);

  useEffect(() => { gameStateRef.current = gameState; }, [gameState]);
  const keysRef = useRef({});
  const difficultyRef = useRef({ speed: 3, spawnRate: 1500, lastSpawn: 0 });
  const scoreRef = useRef(0);
  const livesRef = useRef(5);
  const coinsRef2 = useRef(0);
  const mouseXRef = useRef(null);
  const touchXRef = useRef(null);
  const touchDirectionRef = useRef(null); // 'left', 'right', 또는 null
  const leftButtonRef = useRef(null);
  const damageTimeoutRef = useRef(null);
  const rightButtonRef = useRef(null);

  const playerDOMRef = useRef(null);
  const birdsDOMEscape = useRef(null);
  const gameBoardRef = useRef(null);

  useEffect(() => {
    const handleKeyDown = (e) => {
      keysRef.current[e.key] = true;
      if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
        if (gameState === GAME_STATES.PLAYING) pauseGame();
        else if (gameState === GAME_STATES.PAUSED) resumeGame();
      }
      // 스페이스바: 미사일 발사(키보드 폴백)
      if (e.key === ' ' && !e.repeat && gameState === GAME_STATES.PLAYING) {
        const now = performance.now();
        if (now - lastFireTimeRef.current > PUNCH_COOLDOWN_MS) {
          lastFireTimeRef.current = now;
          fireMissile();
        }
      }
    };
    const handleKeyUp = (e) => { keysRef.current[e.key] = false; };
    // 실제 마우스만 받음(터치에서 합성된 mousemove 무시 → 점프 버그 방지)
    const handlePointerMove = (e) => {
      if (e.pointerType !== 'mouse') return;
      if (gameState !== GAME_STATES.PLAYING || !gameBoardRef.current) return;
      const rect = gameBoardRef.current.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      mouseXRef.current = Math.max(0, Math.min(GAME_WIDTH - PLAYER_SIZE, mouseX - PLAYER_SIZE / 2));
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('pointermove', handlePointerMove);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('pointermove', handlePointerMove);
    };
  }, [gameState]);

  const resetGame = () => {
    playerXRef.current = GAME_WIDTH / 2 - PLAYER_SIZE / 2;
    collisionXRef.current = GAME_WIDTH / 2 - PLAYER_SIZE / 2;
    birdsRef.current = [];
    aliensRef.current = [];
    coinsRef.current = [];
    shieldsRef.current = [];
    alienSpawnRef.current.lastSpawn = performance.now();
    lastAlienSpawnScoreRef.current = 0;
    lastCoinSpawnScoreRef.current = 0;
    lastShieldSpawnScoreRef.current = 0;
    invincibleUntilRef.current = 0;
    shieldSecondsLeftRef.current = 0;
    coinShowerRef.current = { active: false, rowsRemaining: 0, nextSpawnTime: 0 };
    coinShowerTriggeredRef.current = false;
    missilesRef.current = [];
    handAreaHistoryRef.current = [];
    lastFireTimeRef.current = 0;
    difficultyRef.current = { speed: 4, spawnRate: 1200, lastSpawn: performance.now() };
    scoreRef.current = 0;
    livesRef.current = 5;
    coinsRef2.current = 0;
    mouseXRef.current = null;
    touchXRef.current = null;
    touchDirectionRef.current = null;
    setScore(0);
    setLives(5);
    setCoins(0);
    setShieldSecondsLeft(0);
    setIsDamaged(false);
    setIsExploding(false);
    if (damageTimeoutRef.current) {
      clearTimeout(damageTimeoutRef.current);
      damageTimeoutRef.current = null;
    }
    setGameState(GAME_STATES.PLAYING);
  };


  const startCameraTracking = () => {
    const W = 200;   // 미리보기 캔버스 가로
    const H = 150;   // 미리보기 캔버스 세로
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const v = videoElRef.current;
    const VW = v.videoWidth || 320;
    const VH = v.videoHeight || 240;
    const sx = W / VW;
    const sy = H / VH;

    const tick = () => {
      if (!cameraEnabledRef.current || !videoElRef.current) return;
      const vid = videoElRef.current;
      if (vid.readyState >= 2) {
        // 영상을 좌우 반전(거울 모드)으로 미리보기에 그리기
        ctx.save();
        ctx.setTransform(-1, 0, 0, 1, W, 0);
        ctx.drawImage(vid, 0, 0, W, H);
        ctx.restore();

        // 얼굴 감지
        if (faceDetectorRef.current) {
          try {
            const result = faceDetectorRef.current.detectForVideo(vid, performance.now());
            if (result.detections && result.detections.length > 0) {
              // 가장 큰 얼굴 선택
              let best = result.detections[0];
              let bestArea = best.boundingBox.width * best.boundingBox.height;
              for (let i = 1; i < result.detections.length; i++) {
                const bb = result.detections[i].boundingBox;
                const area = bb.width * bb.height;
                if (area > bestArea) { best = result.detections[i]; bestArea = area; }
              }
              const box = best.boundingBox;
              // 거울 모드 적용: 원본 x → 반전된 x
              const mirroredX = VW - box.originX - box.width;
              const centerX = mirroredX + box.width / 2;

              // 얼굴 중심을 로켓 위치로 매핑(양쪽 10% 패딩)
              const padding = 0.10;
              let norm = (centerX / VW - padding) / (1 - 2 * padding);
              norm = Math.max(0, Math.min(1, norm));
              const target = norm * (GAME_WIDTH - PLAYER_SIZE);
              const alpha = 0.35;
              cameraXRef.current = cameraXRef.current == null
                ? target
                : cameraXRef.current * (1 - alpha) + target * alpha;

              // 미리보기 위에 얼굴 박스 그리기(거울 좌표로)
              const bx = mirroredX * sx;
              const by = box.originY * sy;
              const bw = box.width * sx;
              const bh = box.height * sy;
              ctx.lineWidth = 2.5;
              ctx.strokeStyle = '#22ff88';
              ctx.shadowColor = 'rgba(34, 255, 136, 0.8)';
              ctx.shadowBlur = 6;
              ctx.strokeRect(bx, by, bw, bh);
              ctx.shadowBlur = 0;
              // 박스 중심점(레이저 포인터 느낌)
              ctx.fillStyle = '#22ff88';
              ctx.beginPath();
              ctx.arc(bx + bw / 2, by + bh / 2, 3, 0, Math.PI * 2);
              ctx.fill();
            }
          } catch { /* 감지 실패는 무시 */ }
        }

        // 손 감지 + 펀치(면적 급증) 판정
        if (handDetectorRef.current && gameStateRef.current === GAME_STATES.PLAYING) {
          try {
            const handResult = handDetectorRef.current.detectForVideo(vid, performance.now());
            if (handResult.landmarks && handResult.landmarks.length > 0) {
              const lm = handResult.landmarks[0];
              let minX = 1, maxX = 0, minY = 1, maxY = 0;
              for (let k = 0; k < lm.length; k++) {
                const p = lm[k];
                if (p.x < minX) minX = p.x;
                if (p.x > maxX) maxX = p.x;
                if (p.y < minY) minY = p.y;
                if (p.y > maxY) maxY = p.y;
              }
              const handW = maxX - minX;
              const handH = maxY - minY;
              const area = handW * handH; // 0..1 정규화 면적

              // 시간 윈도우 내 면적 이력 유지
              const now = performance.now();
              const hist = handAreaHistoryRef.current;
              hist.push({ time: now, area });
              while (hist.length > 0 && now - hist[0].time > PUNCH_WINDOW_MS) hist.shift();

              // 펀치 판정: 윈도우 시작 시점 면적 대비 현재 면적이 급증
              if (hist.length >= 3 && area > PUNCH_MIN_AREA) {
                const oldArea = hist[0].area;
                if (oldArea > 0 && area / oldArea > PUNCH_AREA_RATIO
                    && now - lastFireTimeRef.current > PUNCH_COOLDOWN_MS) {
                  lastFireTimeRef.current = now;
                  fireMissile();
                  handAreaHistoryRef.current = []; // 재판정 방지
                }
              }

              // 미리보기에 손 바운딩 박스(거울 좌표)
              const hx = (1 - maxX) * W;
              const hy = minY * H;
              const hw = (maxX - minX) * W;
              const hh = (maxY - minY) * H;
              ctx.lineWidth = 2;
              ctx.strokeStyle = '#ffaa00';
              ctx.shadowColor = 'rgba(255,170,0,0.7)';
              ctx.shadowBlur = 6;
              ctx.strokeRect(hx, hy, hw, hh);
              ctx.shadowBlur = 0;
            } else {
              handAreaHistoryRef.current = [];
            }
          } catch { /* 감지 실패는 무시 */ }
        }
      }
      cameraRafRef.current = requestAnimationFrame(tick);
    };
    cameraRafRef.current = requestAnimationFrame(tick);
  };

  const enableCamera = async () => {
    if (cameraStatus === 'on' || cameraStatus === 'requesting' || cameraStatus === 'loading') return;
    setCameraStatus('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 320, height: 240 },
        audio: false,
      });
      if (!videoElRef.current) {
        const v = document.createElement('video');
        v.autoplay = true;
        v.playsInline = true;
        v.muted = true;
        videoElRef.current = v;
      }
      videoElRef.current.srcObject = stream;
      await videoElRef.current.play();

      setCameraStatus('loading');
      // MediaPipe Face Detector를 CDN에서 동적 로드
      const visionUrl = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
      const vision = await import(/* @vite-ignore */ visionUrl);
      const filesetResolver = await vision.FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
      );
      const detector = await vision.FaceDetector.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
      });
      faceDetectorRef.current = detector;

      // 주먹 펀치 감지를 위한 Hand Landmarker 로드
      const handDetector = await vision.HandLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
          delegate: 'GPU',
        },
        numHands: 1,
        runningMode: 'VIDEO',
      });
      handDetectorRef.current = handDetector;

      cameraEnabledRef.current = true;
      setCameraStatus('on');
      // 미리보기 캔버스가 렌더된 다음 프레임에 트래킹 시작
      requestAnimationFrame(() => startCameraTracking());
    } catch (e) {
      console.error('Camera enable failed:', e);
      setCameraStatus('error');
      cameraEnabledRef.current = false;
    }
  };

  const disableCamera = () => {
    cameraEnabledRef.current = false;
    if (cameraRafRef.current) {
      cancelAnimationFrame(cameraRafRef.current);
      cameraRafRef.current = null;
    }
    if (videoElRef.current && videoElRef.current.srcObject) {
      videoElRef.current.srcObject.getTracks().forEach(t => t.stop());
      videoElRef.current.srcObject = null;
    }
    if (faceDetectorRef.current && faceDetectorRef.current.close) {
      try { faceDetectorRef.current.close(); } catch { /* noop */ }
    }
    if (handDetectorRef.current && handDetectorRef.current.close) {
      try { handDetectorRef.current.close(); } catch { /* noop */ }
    }
    faceDetectorRef.current = null;
    handDetectorRef.current = null;
    handAreaHistoryRef.current = [];
    cameraXRef.current = null;
    setCameraStatus('off');
  };

  // 컴포넌트 언마운트 시 카메라 정리
  useEffect(() => {
    return () => {
      cameraEnabledRef.current = false;
      if (cameraRafRef.current) cancelAnimationFrame(cameraRafRef.current);
      if (videoElRef.current && videoElRef.current.srcObject) {
        videoElRef.current.srcObject.getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  const pauseGame = () => {
    if (gameState !== GAME_STATES.PLAYING) return;
    pauseStartedAtRef.current = performance.now();
    // 마우스/터치 입력이 남아 해제 시 플레이어가 점프하지 않도록 초기화
    mouseXRef.current = null;
    touchDirectionRef.current = null;
    setGameState(GAME_STATES.PAUSED);
  };

  const resumeGame = () => {
    if (gameState !== GAME_STATES.PAUSED) return;
    const now = performance.now();
    const delta = now - (pauseStartedAtRef.current || now);
    // 일시정지 동안 흐른 시간을 모든 절대 시각 ref에 보정
    if (delta > 0) {
      difficultyRef.current.lastSpawn += delta;
      alienSpawnRef.current.lastSpawn += delta;
      if (invincibleUntilRef.current > 0) invincibleUntilRef.current += delta;
      if (coinShowerRef.current.active) {
        coinShowerRef.current.nextSpawnTime += delta;
      }
    }
    pauseStartedAtRef.current = 0;
    setGameState(GAME_STATES.PLAYING);
  };

  const gameLoop = useCallback((time) => {
    if (gameState !== GAME_STATES.PLAYING) return;

    if (lastTimeRef.current != null) {
      if (!isExploding) {
        updatePlayer();
        updateBirds(time);
        updateAliens(time);
        updateCoins(time);
        updateShields(time);
        updateMissiles();
        updateCoinShower(time);
        updateInvincibilityTimer(time);
        checkCollisions();
      }
      renderPositions();
    }

    lastTimeRef.current = time;
    requestRef.current = requestAnimationFrame(gameLoop);
  }, [gameState, isExploding]);

  useEffect(() => {
    if (gameState === GAME_STATES.PLAYING) {
      lastTimeRef.current = performance.now();
      requestRef.current = requestAnimationFrame(gameLoop);
    }
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [gameState, gameLoop]);

  const updatePlayer = () => {
    if (isDamaged || isExploding) return;

    const speed = 7;
    let x = playerXRef.current;

    if (cameraEnabledRef.current && cameraXRef.current !== null) {
      x = cameraXRef.current;
    } else if (mouseXRef.current !== null) {
      x = mouseXRef.current;
    } else if (touchDirectionRef.current === 'left') {
      x -= speed;
    } else if (touchDirectionRef.current === 'right') {
      x += speed;
    } else if (keysRef.current['ArrowLeft'] || keysRef.current['a'] || keysRef.current['A']) {
      x -= speed;
    } else if (keysRef.current['ArrowRight'] || keysRef.current['d'] || keysRef.current['D']) {
      x += speed;
    }

    if (x < 0) x = 0;
    if (x > GAME_WIDTH - PLAYER_SIZE) x = GAME_WIDTH - PLAYER_SIZE;

    playerXRef.current = x;
  };

  const updateBirds = (time) => {
    const { speed, spawnRate, lastSpawn } = difficultyRef.current;

    // 코인 샤워 중에는 운석을 새로 만들지 않음(기존 운석은 계속 떨어짐)
    if (!coinShowerRef.current.active && time - lastSpawn > spawnRate) {
      const newX = Math.random() * (GAME_WIDTH - BIRD_SIZE);
      birdsRef.current.push({ id: Math.random(), x: newX, y: -BIRD_SIZE });
      difficultyRef.current.lastSpawn = time;

      difficultyRef.current.spawnRate = Math.max(300, spawnRate - 30);
      difficultyRef.current.speed += 0.05;
    }

    let newScore = scoreRef.current;

    birdsRef.current.forEach(bird => {
      bird.y += speed;
    });

    const remainingBirds = birdsRef.current.filter(bird => {
      if (bird.y > GAME_HEIGHT) {
        newScore += 1;
        return false;
      }
      return true;
    });

    if (newScore !== scoreRef.current) {
      const prevScore = scoreRef.current;
      scoreRef.current = newScore;
      setScore(newScore); // 비동기 상태 업데이트이므로 병목 없음

      // 500점 도달 시 코인 샤워 트리거(1회만): 10줄 × 10개 = 100개
      if (!coinShowerTriggeredRef.current && newScore >= 500) {
        coinShowerTriggeredRef.current = true;
        coinShowerRef.current = {
          active: true,
          rowsRemaining: 10,
          nextSpawnTime: time,
        };
      }

      // 코인 샤워 중에는 외계인/코인/방패 추가 스폰을 막음
      if (coinShowerRef.current.active) {
        birdsRef.current = remainingBirds;
        return;
      }

      // Spawn alien when score passes thresholds: after >100, every multiple of 30
      if (newScore > 100 && newScore % 30 === 0 && lastAlienSpawnScoreRef.current !== newScore && aliensRef.current.length < 1) {
        const spawnX = Math.random() * (GAME_WIDTH - ALIEN_SIZE);
        aliensRef.current.push({ id: Math.random(), x: spawnX, y: -ALIEN_SIZE, stopped: false });
        lastAlienSpawnScoreRef.current = newScore;
        alienSpawnRef.current.lastSpawn = time;
      }
      // Spawn coin when score is multiple of 6
      if (newScore % 6 === 0 && lastCoinSpawnScoreRef.current !== newScore) {
        const spawnX = Math.random() * (GAME_WIDTH - 20);
        coinsRef.current.push({ id: Math.random(), x: spawnX, y: -20 });
        lastCoinSpawnScoreRef.current = newScore;
      }
      // 150점 경계를 넘을 때마다 방패(무적) 아이템 등장
      // (한 프레임에 점수가 여러 번 올라 150을 건너뛰어도 감지)
      const prev150 = Math.floor(prevScore / 150);
      const new150 = Math.floor(newScore / 150);
      if (new150 > prev150 && lastShieldSpawnScoreRef.current !== new150) {
        if (Math.random() < SHIELD_SPAWN_CHANCE) {
          // 외계인과 가로 위치가 겹치지 않게 x 위치를 최대 20번까지 재시도
          const overlapMargin = 8;
          let spawnX = 0;
          for (let attempt = 0; attempt < 20; attempt++) {
            spawnX = Math.random() * (GAME_WIDTH - SHIELD_SIZE);
            let overlapsAlien = false;
            for (let ai = 0; ai < aliensRef.current.length; ai++) {
              const a = aliensRef.current[ai];
              // 위쪽에 있는 외계인하고만 비교(아래로 이미 내려간 건 무시)
              if (a.y > GAME_HEIGHT / 2) continue;
              if (
                spawnX < a.x + ALIEN_SIZE + overlapMargin &&
                spawnX + SHIELD_SIZE + overlapMargin > a.x
              ) {
                overlapsAlien = true;
                break;
              }
            }
            if (!overlapsAlien) break;
          }
          shieldsRef.current.push({ id: Math.random(), x: spawnX, y: -SHIELD_SIZE });
        }
        lastShieldSpawnScoreRef.current = new150;
      }
    }

    birdsRef.current = remainingBirds;
  };

  const updateAliens = () => {
    // aliens fall like meteors; if they miss the rocket they keep falling and are removed off-screen
    const baseMeteorSpeed = difficultyRef.current?.speed ?? 3;
    const speed = Math.max(1.0, baseMeteorSpeed * 0.8);

    for (let i = 0; i < aliensRef.current.length; i++) {
      const alien = aliensRef.current[i];
      alien.y += speed;
    }

    // remove aliens that passed the bottom
    aliensRef.current = aliensRef.current.filter(a => a.y <= GAME_HEIGHT + ALIEN_SIZE);
  };

  const updateCoins = () => {
    // 코인 샤워 중에는 천천히 떨어져 한 줄씩 또렷이 보이게 함
    const baseSpeed = difficultyRef.current?.speed ?? 3;
    const speed = coinShowerRef.current.active ? 2.2 : baseSpeed * 0.7;
    coinsRef.current.forEach(coin => {
      coin.y += speed;
    });

    // Remove coins that left screen
    coinsRef.current = coinsRef.current.filter(c => c.y <= GAME_HEIGHT + 20);
  };

  const fireMissile = () => {
    if (gameStateRef.current !== GAME_STATES.PLAYING) return;
    missilesRef.current.push({
      id: Math.random(),
      x: playerXRef.current + PLAYER_SIZE / 2 - MISSILE_WIDTH / 2,
      y: PLAYER_Y - MISSILE_HEIGHT,
    });
  };

  const updateMissiles = () => {
    for (let i = missilesRef.current.length - 1; i >= 0; i--) {
      const m = missilesRef.current[i];
      m.y -= MISSILE_SPEED;
      if (m.y + MISSILE_HEIGHT < 0) {
        missilesRef.current.splice(i, 1);
        continue;
      }
      // 운석 충돌(파괴 + 점수 +5)
      let consumed = false;
      for (let j = birdsRef.current.length - 1; j >= 0; j--) {
        const b = birdsRef.current[j];
        if (m.x < b.x + BIRD_SIZE && m.x + MISSILE_WIDTH > b.x
            && m.y < b.y + BIRD_SIZE && m.y + MISSILE_HEIGHT > b.y) {
          birdsRef.current.splice(j, 1);
          scoreRef.current += 5;
          setScore(scoreRef.current);
          missilesRef.current.splice(i, 1);
          consumed = true;
          break;
        }
      }
      if (consumed) continue;
      // 외계인 충돌(파괴 + 점수 +20)
      for (let j = aliensRef.current.length - 1; j >= 0; j--) {
        const a = aliensRef.current[j];
        if (m.x < a.x + ALIEN_SIZE && m.x + MISSILE_WIDTH > a.x
            && m.y < a.y + ALIEN_SIZE && m.y + MISSILE_HEIGHT > a.y) {
          aliensRef.current.splice(j, 1);
          scoreRef.current += 20;
          setScore(scoreRef.current);
          missilesRef.current.splice(i, 1);
          break;
        }
      }
    }
  };

  const updateShields = () => {
    // 외계인과 동일한 속도
    const baseSpeed = difficultyRef.current?.speed ?? 3;
    const speed = Math.max(1.0, baseSpeed * 0.8);
    for (let i = 0; i < shieldsRef.current.length; i++) {
      shieldsRef.current[i].y += speed;
    }
    // 화면 아래로 나간 방패 제거
    shieldsRef.current = shieldsRef.current.filter(s => s.y <= GAME_HEIGHT + SHIELD_SIZE);
  };

  const updateCoinShower = (time) => {
    const shower = coinShowerRef.current;
    if (!shower.active) return;

    const COINS_PER_ROW = 10;
    const ROW_DELAY_MS = 450; // 줄 사이 간격을 넓혀 한 줄씩 또렷이 떨어지게
    const slot = GAME_WIDTH / COINS_PER_ROW;

    if (shower.rowsRemaining > 0 && time >= shower.nextSpawnTime) {
      for (let i = 0; i < COINS_PER_ROW; i++) {
        const x = i * slot + (slot - 20) / 2;
        coinsRef.current.push({ id: Math.random() + i, x, y: -20 });
      }
      shower.rowsRemaining -= 1;
      shower.nextSpawnTime = time + ROW_DELAY_MS;
    }

    // 모든 줄이 다 떨어졌고, 남은 코인이 없으면 샤워 종료(운석/외계인 재개)
    if (shower.rowsRemaining === 0 && coinsRef.current.length === 0) {
      shower.active = false;
    }
  };

  const updateInvincibilityTimer = (time) => {
    const remainingMs = invincibleUntilRef.current - time;
    const remainingSec = remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
    if (remainingSec !== shieldSecondsLeftRef.current) {
      shieldSecondsLeftRef.current = remainingSec;
      setShieldSecondsLeft(remainingSec);
    }
  };

  const checkCollisions = () => {
    const px = playerXRef.current;
    const py = PLAYER_Y;
    const pSize = PLAYER_SIZE;
    const m = HITBOX_MARGIN;
    const isInvincible = performance.now() < invincibleUntilRef.current;

    for (let i = 0; i < birdsRef.current.length; i++) {
      const b = birdsRef.current[i];
      const bx = b.x;
      const by = b.y;
      const bSize = BIRD_SIZE;

      if (
        px + m < bx + bSize - m &&
        px + pSize - m > bx + m &&
        py + m < by + bSize - m &&
        py + pSize - m > by + m
      ) {
        // 무적 상태면 운석을 그냥 제거(데미지 없음)
        if (isInvincible) {
          birdsRef.current.splice(i, 1);
          break;
        }
        collisionXRef.current = playerXRef.current;
        birdsRef.current.splice(i, 1);
        livesRef.current -= 1;
        if (livesRef.current <= 0) {
          setLives(livesRef.current);
          setIsExploding(true);
          if (damageTimeoutRef.current) {
            clearTimeout(damageTimeoutRef.current);
          }
          damageTimeoutRef.current = setTimeout(() => {
            setGameState(GAME_STATES.GAME_OVER);
            setIsExploding(false);
          }, 600);
        } else {
          setLives(livesRef.current);
          setIsDamaged(true);
          if (damageTimeoutRef.current) {
            clearTimeout(damageTimeoutRef.current);
          }
          damageTimeoutRef.current = setTimeout(() => {
            setIsDamaged(false);
            damageTimeoutRef.current = null;
          }, 800);
        }
        break;
      }
    }

    // Check alien blocking collisions (does not kill player, just blocks movement)
    for (let i = 0; i < aliensRef.current.length; i++) {
      const a = aliensRef.current[i];
      const ax = a.x;
      const ay = a.y;
      const aSize = ALIEN_SIZE;

      if (
        px + m < ax + aSize - m &&
        px + pSize - m > ax + m &&
        py + m < ay + aSize - m &&
        py + pSize - m > ay + m
      ) {
        // 무적 상태면 외계인을 그냥 제거(데미지 없음)
        if (isInvincible) {
          aliensRef.current.splice(i, 1);
          break;
        }
        // Alien hit: deduct 2 lives
        aliensRef.current.splice(i, 1);
        livesRef.current -= 2;
        if (livesRef.current <= 0) {
          setLives(livesRef.current);
          setIsExploding(true);
          if (damageTimeoutRef.current) clearTimeout(damageTimeoutRef.current);
          damageTimeoutRef.current = setTimeout(() => {
            setGameState(GAME_STATES.GAME_OVER);
            setIsExploding(false);
          }, 600);
        } else {
          setLives(livesRef.current);
          setIsDamaged(true);
          if (damageTimeoutRef.current) clearTimeout(damageTimeoutRef.current);
          damageTimeoutRef.current = setTimeout(() => {
            setIsDamaged(false);
            damageTimeoutRef.current = null;
          }, 1000);
        }
        break;
      }
    }

    // Check coin collisions (확장된 픽업 범위 사용)
    const r = COIN_PICKUP_RANGE;
    for (let i = 0; i < coinsRef.current.length; i++) {
      const c = coinsRef.current[i];
      const cx = c.x;
      const cy = c.y;
      const coinSize = 20;

      if (
        px - r < cx + coinSize &&
        px + pSize + r > cx &&
        py - r < cy + coinSize &&
        py + pSize + r > cy
      ) {
        // Coin hit: collect coin
        coinsRef.current.splice(i, 1);
        coinsRef2.current += 1;
        // 코인 10개마다 자동으로 목숨 1개로 변환
        if (coinsRef2.current >= 10) {
          coinsRef2.current -= 10;
          livesRef.current += 1;
          setLives(livesRef.current);
        }
        setCoins(coinsRef2.current);
        break;
      }
    }

    // 방패 픽업: 5초 무적
    for (let i = 0; i < shieldsRef.current.length; i++) {
      const s = shieldsRef.current[i];
      if (
        px - HITBOX_MARGIN < s.x + SHIELD_SIZE &&
        px + pSize + HITBOX_MARGIN > s.x &&
        py - HITBOX_MARGIN < s.y + SHIELD_SIZE &&
        py + pSize + HITBOX_MARGIN > s.y
      ) {
        shieldsRef.current.splice(i, 1);
        invincibleUntilRef.current = performance.now() + SHIELD_DURATION;
        break;
      }
    }
  };

  const renderPositions = () => {
    if (playerDOMRef.current) {
      const x = isDamaged || isExploding ? collisionXRef.current : playerXRef.current;
      playerDOMRef.current.style.transform = `translate(${x}px, ${PLAYER_Y}px)`;
    }

    const container = birdsDOMEscape.current;
    if (container) {
      let html = '';
      for (let i = 0; i < birdsRef.current.length; i++) {
        const b = birdsRef.current[i];
        html += `<div style="
          position: absolute;
          left: 0;
          top: 0;
          width: ${BIRD_SIZE}px;
          height: ${BIRD_SIZE}px;
          transform: translate(${b.x}px, ${b.y}px);
          display: flex;
          justify-content: center;
          align-items: center;
        ">
          <img src="/meteor.png" alt="meteor" style="width: 100%; height: 100%; object-fit: contain; filter: drop-shadow(0 0 8px rgba(255,60,0,0.8));" />
        </div>`;
      }
      // Render aliens (ball-shaped)
      for (let i = 0; i < aliensRef.current.length; i++) {
        const a = aliensRef.current[i];
        html += `<div style="
          position: absolute;
          left: 0;
          top: 0;
          width: ${ALIEN_SIZE}px;
          height: ${ALIEN_SIZE}px;
          transform: translate(${a.x}px, ${a.y}px);
          display: flex;
          justify-content: center;
          align-items: center;
        ">
          <div style="width:100%;height:100%;border-radius:50%;background: radial-gradient(circle at 30% 30%, #ffffff 5%, #a5ffb8 30%, #00a04e 70%);border:2px solid rgba(255,255,255,0.08);box-shadow:0 6px 18px rgba(0,160,80,0.45);"></div>
        </div>`;
      }
      // Render coins
      for (let i = 0; i < coinsRef.current.length; i++) {
        const coin = coinsRef.current[i];
        html += `<div style="
          position: absolute;
          left: 0;
          top: 0;
          width: 20px;
          height: 20px;
          transform: translate(${coin.x}px, ${coin.y}px);
          display: flex;
          justify-content: center;
          align-items: center;
        ">
          <div style="width:100%;height:100%;border-radius:50%;background: radial-gradient(circle at 35% 35%, #ffff99, #ffdd00);border:1px solid rgba(255,255,0,0.3);box-shadow:0 0 8px rgba(255,215,0,0.8);"></div>
        </div>`;
      }
      // Render missiles(미사일: 위로 발사)
      for (let i = 0; i < missilesRef.current.length; i++) {
        const m = missilesRef.current[i];
        html += `<div style="
          position: absolute;
          left: 0;
          top: 0;
          width: ${MISSILE_WIDTH}px;
          height: ${MISSILE_HEIGHT}px;
          transform: translate(${m.x}px, ${m.y}px);
          background: linear-gradient(to top, rgba(255,255,255,0.0), #fff 30%, #00ffff);
          border-radius: 3px;
          box-shadow: 0 0 10px rgba(0, 255, 255, 0.9), 0 0 20px rgba(0, 200, 255, 0.6);
        "></div>`;
      }
      // Render shields (방패 모양)
      for (let i = 0; i < shieldsRef.current.length; i++) {
        const s = shieldsRef.current[i];
        html += `<div style="
          position: absolute;
          left: 0;
          top: 0;
          width: ${SHIELD_SIZE}px;
          height: ${SHIELD_SIZE}px;
          transform: translate(${s.x}px, ${s.y}px);
          display: flex;
          justify-content: center;
          align-items: center;
          filter: drop-shadow(0 0 8px rgba(100, 200, 255, 0.9));
        ">
          <svg viewBox="0 0 24 24" width="100%" height="100%">
            <defs>
              <linearGradient id="shieldGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stop-color="#aee7ff"/>
                <stop offset="60%" stop-color="#3fa8ff"/>
                <stop offset="100%" stop-color="#1565c0"/>
              </linearGradient>
            </defs>
            <path d="M12 2 L21 5 V11 C21 16.5 17 21 12 22 C7 21 3 16.5 3 11 V5 Z" fill="url(#shieldGrad)" stroke="#ffffff" stroke-width="1.2"/>
            <path d="M9 12 L11 14 L15 9.5" fill="none" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>`;
      }
      container.innerHTML = html;
    }
  };

  return (
    <div style={styles.container}>
      <div ref={gameBoardRef} style={styles.gameBoard}>
        {/* Star Background Engine */}
        <div style={styles.starsLayer1} />
        <div style={styles.starsLayer2} />

        <div style={styles.scanlines} />

        {isExploding && (
          <div style={styles.explosionOverlay}>
            <div style={styles.explosionEmoji}>💥</div>
          </div>
        )}

        {(gameState === GAME_STATES.PLAYING || gameState === GAME_STATES.PAUSED) && shieldSecondsLeft > 0 && (
          <div style={styles.shieldTimer}>
            <div>🛡️ {shieldSecondsLeft}s</div>
          </div>
        )}

        {(gameState === GAME_STATES.PLAYING || gameState === GAME_STATES.PAUSED) && (
          <div
            style={styles.pauseButton}
            onPointerDown={(e) => {
              e.stopPropagation();
              if (gameState === GAME_STATES.PLAYING) pauseGame();
              else resumeGame();
            }}
            onContextMenu={(e) => e.preventDefault()}
          >
            {gameState === GAME_STATES.PLAYING ? '⏸' : '▶'}
          </div>
        )}

        {gameState === GAME_STATES.PAUSED && (
          <div style={styles.overlay}>
            <h1 style={styles.pausedText}>PAUSED</h1>
            <p style={{ color: '#aaa', fontSize: '14px', marginBottom: '30px', letterSpacing: '2px' }}>
              P / ESC 또는 ▶ 버튼으로 재개
            </p>
            <button
              style={styles.button}
              onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
              onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
              onClick={resumeGame}
            >
              RESUME
            </button>
          </div>
        )}

        {gameState === GAME_STATES.PLAYING && (
          <div style={styles.scoreBoard}>
            <div>SCORE: {score.toString().padStart(4, '0')}</div>
            <div style={{ marginTop: '6px', fontSize: '16px', color: '#ffcc00' }}>
              LIVES: {lives}
            </div>
            <div style={{ marginTop: '6px', fontSize: '16px', color: '#ffff00' }}>
              COINS: {coins}/10
            </div>
            {cameraStatus === 'on' && (
              <div style={{ marginTop: '6px', fontSize: '14px', color: '#22c55e' }}>
                📷 CAM
              </div>
            )}
          </div>
        )}


        {/* DOM Escape Layer for performance */}
        <div ref={birdsDOMEscape} style={styles.birdsContainer} />

        {/* Player Object */}
        <div
          ref={playerDOMRef}
          style={{
            ...(styles.player),
            transform: `translate(${(isDamaged || isExploding ? collisionXRef.current : playerXRef.current)}px, ${PLAYER_Y}px)`,
            display: gameState !== GAME_STATES.START ? 'flex' : 'none',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              width: '100%',
              height: '100%',
              fontSize: isExploding ? '60px' : '32px',
              animation: isExploding
                ? 'explode 0.6s ease-out forwards'
                : isDamaged
                ? 'wobble 0.8s ease-in-out'
                : undefined,
            }}
          >
              {isExploding ? '💥' : '🚀'}
            </div>
        </div>

        {gameState === GAME_STATES.START && (
          <div style={styles.overlay}>
            <div style={styles.titleContainer}>
              <h1 style={styles.title}>마테오 다이어트</h1>
              <h2 style={styles.subtitle}>이민건이 만듬</h2>
            </div>
            <div style={styles.instructionBox}>
              <p style={styles.instructions}>인계초등학교</p>
              <p style={styles.instructionKey}>만드는데 힘들었다.</p>
              <p style={styles.instructions}>100%로 완성</p>
            </div>
            <button
              style={styles.button}
              onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
              onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
              onClick={resetGame}
            >
              MISSION START
            </button>
            <button
              style={{
                ...styles.button,
                marginTop: '12px',
                backgroundColor: cameraStatus === 'on' ? '#22c55e' : '#444',
                fontSize: '14px',
                padding: '10px 20px',
              }}
              onClick={() => cameraStatus === 'on' ? disableCamera() : enableCamera()}
            >
              {cameraStatus === 'on' ? '📷 얼굴 추적: ON' :
                cameraStatus === 'requesting' ? '📷 권한 요청중...' :
                cameraStatus === 'loading' ? '📷 얼굴 인식 모델 로드중...' :
                cameraStatus === 'error' ? '📷 카메라 오류 (재시도)' :
                '📷 얼굴로 조작'}
            </button>
          </div>
        )}

        {gameState === GAME_STATES.GAME_OVER && (
          <div style={styles.overlay}>
            <h1 style={styles.gameOverText}>GAME OVER</h1>
            <div style={styles.scoreContainer}>
              <p style={styles.finalScoreLabel}>FINAL SCORE</p>
              <p style={styles.finalScoreValue}>{score}</p>
            </div>
            <button
              style={{ ...(styles.button), backgroundColor: '#ff0055', borderColor: 'transparent' }}
              onMouseEnter={(e) => Object.assign(e.currentTarget.style, { transform: 'scale(1.05)', boxShadow: '0 0 20px #ff0055' })}
              onMouseLeave={(e) => Object.assign(e.currentTarget.style, { transform: 'scale(1)', boxShadow: '0 0 10px #ff0055' })}
              onClick={resetGame}
            >
              RETRY MISSION
            </button>
          </div>
        )}

        {gameState === GAME_STATES.PLAYING && (
          <div style={styles.mobileController}>
            <div
              ref={leftButtonRef}
              style={styles.controlButton}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                touchDirectionRef.current = 'left';
              }}
              onPointerUp={() => { touchDirectionRef.current = null; }}
              onPointerCancel={() => { touchDirectionRef.current = null; }}
              onPointerLeave={() => { touchDirectionRef.current = null; }}
              onContextMenu={(e) => e.preventDefault()}
            >
              ◀
            </div>
            <div
              ref={rightButtonRef}
              style={styles.controlButton}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                touchDirectionRef.current = 'right';
              }}
              onPointerUp={() => { touchDirectionRef.current = null; }}
              onPointerCancel={() => { touchDirectionRef.current = null; }}
              onPointerLeave={() => { touchDirectionRef.current = null; }}
              onContextMenu={(e) => e.preventDefault()}
            >
              ▶
            </div>
          </div>
        )}
      </div>

      <canvas
        ref={previewCanvasRef}
        width={200}
        height={150}
        style={{
          ...styles.cameraPreview,
          display: cameraStatus === 'on' ? 'block' : 'none',
        }}
      />
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    height: '100vh',
    width: '100vw',
    backgroundColor: '#050510',
    fontFamily: '"Segoe UI", Tahoma, Geneva, Verdana, sans-serif',
    margin: 0,
    padding: 0,
    overflow: 'hidden',
  },
  gameBoard: {
    position: 'relative',
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    backgroundColor: '#0a0a1a',
    overflow: 'hidden',
    boxShadow: '0 0 40px rgba(0, 255, 200, 0.15), inset 0 0 20px rgba(0, 0, 0, 0.8)',
    border: '2px solid #223',
    borderRadius: '12px',
    backgroundImage: 'linear-gradient(to bottom, #050510, #13132d)',
  },
  starsLayer1: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1,
    backgroundImage: 'radial-gradient(1px 1px at 10% 20%, #ffffff, rgba(0,0,0,0)), radial-gradient(1.5px 1.5px at 30% 50%, #aaaaaa, rgba(0,0,0,0)), radial-gradient(2px 2px at 60% 80%, #ffffff, rgba(0,0,0,0)), radial-gradient(1px 1px at 80% 10%, #777777, rgba(0,0,0,0)), radial-gradient(1.5px 1.5px at 90% 90%, #ffffff, rgba(0,0,0,0)), radial-gradient(1px 1px at 50% 30%, #aaaaaa, rgba(0,0,0,0))',
    backgroundSize: '100% 100%',
    opacity: 0.6,
  },
  starsLayer2: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1,
    backgroundImage: 'radial-gradient(2px 2px at 20% 70%, #00ffff, rgba(0,0,0,0)), radial-gradient(1.5px 1.5px at 70% 40%, #ff00ff, rgba(0,0,0,0)), radial-gradient(1px 1px at 40% 90%, #ffffff, rgba(0,0,0,0))',
    backgroundSize: '150% 150%',
    opacity: 0.8,
  },
  scanlines: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 40,
    background: 'linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.25) 50%), linear-gradient(90deg, rgba(255, 0, 0, 0.06), rgba(0, 255, 0, 0.02), rgba(0, 0, 255, 0.06))',
    backgroundSize: '100% 4px, 3px 100%',
    pointerEvents: 'none',
  },
  player: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: PLAYER_SIZE,
    height: PLAYER_SIZE,
    fontSize: '32px',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
    willChange: 'transform',
    filter: 'drop-shadow(0 0 10px rgba(0, 255, 255, 0.5))',
  },
  birdsContainer: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: '100%',
    height: '100%',
    zIndex: 5,
    willChange: 'contents',
  },
  scoreBoard: {
    position: 'absolute',
    top: 20,
    left: 20,
    color: '#00ffff',
    fontSize: '20px',
    fontWeight: '900',
    fontStyle: 'italic',
    zIndex: 20,
    textShadow: '0 0 10px rgba(0, 255, 255, 0.5), 2px 2px 0px rgba(0,0,0,0.8)',
    letterSpacing: '2px',
  },
  shieldTimer: {
    position: 'absolute',
    top: 72,
    right: 20,
    color: '#64c8ff',
    fontSize: '20px',
    fontWeight: '900',
    fontStyle: 'italic',
    zIndex: 20,
    textShadow: '0 0 10px rgba(100, 200, 255, 0.7), 2px 2px 0px rgba(0,0,0,0.8)',
    letterSpacing: '2px',
  },
  pauseButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 44,
    height: 44,
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    fontSize: '20px',
    color: '#00ffff',
    backgroundColor: 'rgba(0, 204, 255, 0.18)',
    border: '2px solid #00ccff',
    borderRadius: '8px',
    cursor: 'pointer',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    WebkitTapHighlightColor: 'transparent',
    boxShadow: '0 0 10px rgba(0, 204, 255, 0.4)',
    zIndex: 25,
    touchAction: 'none',
  },
  pausedText: {
    color: '#ffd700',
    fontSize: '56px',
    fontWeight: '900',
    marginBottom: '10px',
    textShadow: '0 0 25px rgba(255, 215, 0, 0.8), 3px 3px 0px #553300',
    letterSpacing: '6px',
  },
  cameraPreview: {
    position: 'fixed',
    bottom: 20,
    right: 20,
    width: 200,
    height: 150,
    border: '2px solid #22ff88',
    borderRadius: '10px',
    boxShadow: '0 0 16px rgba(34, 255, 136, 0.6)',
    backgroundColor: '#000',
    zIndex: 60,
    pointerEvents: 'none',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(5, 5, 15, 0.85)',
    backdropFilter: 'blur(3px)',
    zIndex: 30,
    textAlign: 'center',
  },
  explosionOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    background: 'rgba(255, 120, 30, 0.85)',
    zIndex: 35,
    pointerEvents: 'none',
    animation: 'explosionFlash 0.6s ease-out forwards',
  },
  explosionEmoji: {
    fontSize: '140px',
    textShadow: '0 0 30px rgba(255, 255, 255, 0.9), 0 0 60px rgba(255, 90, 0, 0.8)',
  },
  
  titleContainer: {
    marginBottom: '30px',
    textAlign: 'center',
  },
  title: {
    color: '#ffffff',
    fontSize: '48px',
    margin: '0',
    fontWeight: '900',
    letterSpacing: '5px',
    textShadow: '0 0 20px rgba(0, 255, 255, 0.8), 2px 2px 0px #00ffff',
  },
  subtitle: {
    color: '#ff00ff',
    fontSize: '28px',
    margin: '-10px 0 0 0',
    fontWeight: '900',
    letterSpacing: '8px',
    textShadow: '0 0 15px rgba(255, 0, 255, 0.8)',
  },
  instructionBox: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '8px',
    padding: '15px 25px',
    marginBottom: '30px',
    textAlign: 'center',
  },
  instructions: {
    color: '#aaa',
    fontSize: '14px',
    margin: '5px 0',
  },
  instructionKey: {
    color: '#fff',
    fontSize: '18px',
    fontWeight: 'bold',
    margin: '10px 0',
    letterSpacing: '2px',
  },
  gameOverText: {
    color: '#ff0055',
    fontSize: '64px',
    fontWeight: '900',
    marginBottom: '30px',
    textShadow: '0 0 25px rgba(255, 0, 85, 0.8), 3px 3px 0px #330011',
    letterSpacing: '3px',
  },
  scoreContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    marginBottom: '40px',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    padding: '20px 40px',
    borderRadius: '12px',
    border: '1px solid #334',
  },
  finalScoreLabel: {
    color: '#00ffff',
    fontSize: '16px',
    margin: '0 0 10px 0',
    letterSpacing: '3px',
  },
  finalScoreValue: {
    color: '#ffffff',
    fontSize: '56px',
    margin: 0,
    fontWeight: '900',
    textShadow: '0 0 20px rgba(0, 255, 255, 0.5)',
  },
  button: {
    padding: '16px 32px',
    fontSize: '18px',
    fontWeight: '900',
    letterSpacing: '2px',
    color: '#fff',
    backgroundColor: '#00ccff',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    outline: 'none',
    boxShadow: '0 0 15px rgba(0, 204, 255, 0.5)',
    transition: 'all 0.2s ease-in-out',
    textTransform: 'uppercase',
  },
  mobileController: {
    position: 'fixed',
    bottom: 40,
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    gap: '40px',
    zIndex: 25,
    justifyContent: 'center',
    alignItems: 'center',
  },
  controlButton: {
    width: '80px',
    height: '80px',
    backgroundColor: 'rgba(0, 204, 255, 0.3)',
    border: '2px solid #00ccff',
    borderRadius: '8px',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    fontSize: '36px',
    color: '#00ccff',
    fontWeight: 'bold',
    cursor: 'pointer',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    WebkitTouchCallout: 'none',
    WebkitTapHighlightColor: 'transparent',
    boxShadow: '0 0 10px rgba(0, 204, 255, 0.3)',
    transition: 'transform 0.05s ease-out, background-color 0.05s ease-out',
    touchAction: 'none',
  },
  elevatorButton: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    zIndex: 22,
  },
  elevatorContent: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    width: '80px',
    height: '80px',
    backgroundColor: 'rgba(100,200,255,0.2)',
    border: '2px solid rgba(100,200,255,0.6)',
    borderRadius: '12px',
    cursor: 'pointer',
    transition: 'all 0.2s ease-in-out',
    boxShadow: '0 0 10px rgba(100,200,255,0.5)',
    color: '#64c8ff',
    fontWeight: 'bold',
  },
};

