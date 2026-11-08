import React, { useEffect, useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { EyeBall, Pupil } from "@/src/components/characters/InteractiveEyes";
import SiteFooter from "@/src/components/SiteFooter";
import {
  SpringCloud,
  SpringLantern,
  SpringLatticeWindow,
  SpringPalaceLantern,
  SpringParticles,
  SpringPlumBranch,
  SpringSeal,
} from "./SpringDecor";
import "./spring.css";

interface LoginPageProps {
  onLogin: (password: string) => Promise<{ ok: boolean; error?: string }>;
}

export default function SpringLoginPage({ onLogin }: LoginPageProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [mouseX, setMouseX] = useState<number>(0);
  const [mouseY, setMouseY] = useState<number>(0);
  const [isPurpleBlinking, setIsPurpleBlinking] = useState(false);
  const [isBlackBlinking, setIsBlackBlinking] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [isLookingAtEachOther, setIsLookingAtEachOther] = useState(false);
  const [isPurplePeeking, setIsPurplePeeking] = useState(false);
  const purpleRef = useRef<HTMLDivElement>(null);
  const blackRef = useRef<HTMLDivElement>(null);
  const yellowRef = useRef<HTMLDivElement>(null);
  const orangeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMouseX(e.clientX);
      setMouseY(e.clientY);
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  useEffect(() => {
    const getRandomBlinkInterval = () => Math.random() * 4000 + 3000;
    const scheduleBlink = () => {
      const blinkTimeout = setTimeout(() => {
        setIsPurpleBlinking(true);
        setTimeout(() => {
          setIsPurpleBlinking(false);
          scheduleBlink();
        }, 150);
      }, getRandomBlinkInterval());
      return blinkTimeout;
    };
    const timeout = scheduleBlink();
    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    const getRandomBlinkInterval = () => Math.random() * 4000 + 3000;
    const scheduleBlink = () => {
      const blinkTimeout = setTimeout(() => {
        setIsBlackBlinking(true);
        setTimeout(() => {
          setIsBlackBlinking(false);
          scheduleBlink();
        }, 150);
      }, getRandomBlinkInterval());
      return blinkTimeout;
    };
    const timeout = scheduleBlink();
    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (isTyping) {
      setIsLookingAtEachOther(true);
      const timer = setTimeout(() => {
        setIsLookingAtEachOther(false);
      }, 800);
      return () => clearTimeout(timer);
    }
    setIsLookingAtEachOther(false);
  }, [isTyping]);

  useEffect(() => {
    if (password.length > 0 && showPassword) {
      const schedulePeek = () => {
        const peekInterval = setTimeout(() => {
          setIsPurplePeeking(true);
          setTimeout(() => {
            setIsPurplePeeking(false);
          }, 800);
        }, Math.random() * 3000 + 2000);
        return peekInterval;
      };
      const firstPeek = schedulePeek();
      return () => clearTimeout(firstPeek);
    }
    setIsPurplePeeking(false);
  }, [password, showPassword]);

  const calculatePosition = (ref: React.RefObject<HTMLDivElement | null>) => {
    if (!ref.current) return { faceX: 0, faceY: 0, bodySkew: 0 };
    const rect = ref.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 3;
    const deltaX = mouseX - centerX;
    const deltaY = mouseY - centerY;
    const faceX = Math.max(-15, Math.min(15, deltaX / 20));
    const faceY = Math.max(-10, Math.min(10, deltaY / 30));
    const bodySkew = Math.max(-6, Math.min(6, -deltaX / 120));
    return { faceX, faceY, bodySkew };
  };

  const purplePos = calculatePosition(purpleRef);
  const blackPos = calculatePosition(blackRef);
  const yellowPos = calculatePosition(yellowRef);
  const orangePos = calculatePosition(orangeRef);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    const result = await onLogin(password);
    if (!result.ok) {
      setError(result.error || "登录失败");
    }

    setIsLoading(false);
  };

  return (
    <div className="spring-login">
      <div className="spring-login-grid">
        {/* 左侧：红金舞台 */}
        <section className="spring-login-left">
          <div className="spring-left-hairline" aria-hidden="true" />
          <div className="spring-login-left-watermark" aria-hidden="true">
            福
          </div>
          <SpringLantern
            className="absolute top-0 right-[11%] z-[2] w-[110px] opacity-95"
            delay={0.6}
          />
          <SpringParticles className="spring-stage-particles" />

          <div className="spring-couplet" aria-hidden="true">
            <span>岁岁常欢愉</span>
            <span>年年皆胜意</span>
          </div>

          <header className="spring-login-head">
            <div className="spring-brand-row">
              <span className="spring-brand-mark" aria-hidden="true">
                AI
              </span>
              <div>
                <div className="spring-brand-name">AI 创意工作台</div>
                <div className="spring-brand-sub">新春纳福 · 灵感常新</div>
              </div>
            </div>
            <p className="spring-login-tagline">
              随心的 AI 工作空间，助你的想象插上翅膀。
            </p>
          </header>

          <div className="spring-character-wrap" aria-hidden="true">
            <div className="spring-stage-halo" />
            <SpringLatticeWindow className="spring-stage-window" />
            <div className="spring-stage-floor" />

            <div className="spring-character-stage">
              {/* 朱砂 */}
              <div
                ref={purpleRef}
                className="spring-character spring-char-vermilion absolute bottom-0 transition-all duration-700 ease-in-out"
                style={{
                  left: "70px",
                  width: "180px",
                  height: isTyping || (password.length > 0 && !showPassword) ? "440px" : "400px",
                  borderRadius: "20px 20px 0 0",
                  zIndex: 1,
                  transform:
                    password.length > 0 && showPassword
                      ? "skewX(0deg)"
                      : isTyping || (password.length > 0 && !showPassword)
                        ? `skewX(${(purplePos.bodySkew || 0) - 12}deg) translateX(40px)`
                        : `skewX(${purplePos.bodySkew || 0}deg)`,
                  transformOrigin: "bottom center",
                }}
              >
                <div
                  className="absolute flex gap-8 transition-all duration-700 ease-in-out"
                  style={{
                    left:
                      password.length > 0 && showPassword
                        ? "20px"
                        : isLookingAtEachOther
                          ? "55px"
                          : `${45 + purplePos.faceX}px`,
                    top:
                      password.length > 0 && showPassword
                        ? "35px"
                        : isLookingAtEachOther
                          ? "65px"
                          : `${40 + purplePos.faceY}px`,
                  }}
                >
                  <EyeBall
                    size={18}
                    pupilSize={7}
                    maxDistance={5}
                    isBlinking={isPurpleBlinking}
                    forceLookX={
                      password.length > 0 && showPassword
                        ? isPurplePeeking
                          ? 4
                          : -4
                        : isLookingAtEachOther
                          ? 3
                          : undefined
                    }
                    forceLookY={
                      password.length > 0 && showPassword
                        ? isPurplePeeking
                          ? 5
                          : -4
                        : isLookingAtEachOther
                          ? 4
                          : undefined
                    }
                  />
                  <EyeBall
                    size={18}
                    pupilSize={7}
                    maxDistance={5}
                    isBlinking={isPurpleBlinking}
                    forceLookX={
                      password.length > 0 && showPassword
                        ? isPurplePeeking
                          ? 4
                          : -4
                        : isLookingAtEachOther
                          ? 3
                          : undefined
                    }
                    forceLookY={
                      password.length > 0 && showPassword
                        ? isPurplePeeking
                          ? 5
                          : -4
                        : isLookingAtEachOther
                          ? 4
                          : undefined
                    }
                  />
                </div>
              </div>

              {/* 墨色 */}
              <div
                ref={blackRef}
                className="spring-character spring-char-ink absolute bottom-0 transition-all duration-700 ease-in-out"
                style={{
                  left: "240px",
                  width: "120px",
                  height: "310px",
                  borderRadius: "16px 16px 0 0",
                  zIndex: 2,
                  transform:
                    password.length > 0 && showPassword
                      ? "skewX(0deg)"
                      : isLookingAtEachOther
                        ? `skewX(${(blackPos.bodySkew || 0) * 1.5 + 10}deg) translateX(20px)`
                        : isTyping || (password.length > 0 && !showPassword)
                          ? `skewX(${(blackPos.bodySkew || 0) * 1.5}deg)`
                          : `skewX(${blackPos.bodySkew || 0}deg)`,
                  transformOrigin: "bottom center",
                }}
              >
                <div
                  className="absolute flex gap-6 transition-all duration-700 ease-in-out"
                  style={{
                    left:
                      password.length > 0 && showPassword
                        ? "10px"
                        : isLookingAtEachOther
                          ? "32px"
                          : `${26 + blackPos.faceX}px`,
                    top:
                      password.length > 0 && showPassword
                        ? "28px"
                        : isLookingAtEachOther
                          ? "12px"
                          : `${32 + blackPos.faceY}px`,
                  }}
                >
                  <EyeBall
                    size={16}
                    pupilSize={6}
                    maxDistance={4}
                    isBlinking={isBlackBlinking}
                    forceLookX={
                      password.length > 0 && showPassword
                        ? -4
                        : isLookingAtEachOther
                          ? 0
                          : undefined
                    }
                    forceLookY={
                      password.length > 0 && showPassword
                        ? -4
                        : isLookingAtEachOther
                          ? -4
                          : undefined
                    }
                  />
                  <EyeBall
                    size={16}
                    pupilSize={6}
                    maxDistance={4}
                    isBlinking={isBlackBlinking}
                    forceLookX={
                      password.length > 0 && showPassword
                        ? -4
                        : isLookingAtEachOther
                          ? 0
                          : undefined
                    }
                    forceLookY={
                      password.length > 0 && showPassword
                        ? -4
                        : isLookingAtEachOther
                          ? -4
                          : undefined
                    }
                  />
                </div>
              </div>

              {/* 柿子 */}
              <div
                ref={orangeRef}
                className="spring-character spring-char-persimmon absolute bottom-0 transition-all duration-700 ease-in-out"
                style={{
                  left: "0px",
                  width: "240px",
                  height: "200px",
                  zIndex: 3,
                  borderRadius: "120px 120px 0 0",
                  transform:
                    password.length > 0 && showPassword
                      ? "skewX(0deg)"
                      : `skewX(${orangePos.bodySkew || 0}deg)`,
                  transformOrigin: "bottom center",
                }}
              >
                <div
                  className="absolute flex gap-8 transition-all duration-200 ease-out"
                  style={{
                    left:
                      password.length > 0 && showPassword
                        ? "50px"
                        : `${82 + (orangePos.faceX || 0)}px`,
                    top:
                      password.length > 0 && showPassword
                        ? "85px"
                        : `${90 + (orangePos.faceY || 0)}px`,
                  }}
                >
                  <Pupil
                    size={12}
                    forceLookX={password.length > 0 && showPassword ? -5 : undefined}
                    forceLookY={password.length > 0 && showPassword ? -4 : undefined}
                  />
                  <Pupil
                    size={12}
                    forceLookX={password.length > 0 && showPassword ? -5 : undefined}
                    forceLookY={password.length > 0 && showPassword ? -4 : undefined}
                  />
                </div>
              </div>

              {/* 鎏金 */}
              <div
                ref={yellowRef}
                className="spring-character spring-char-gold absolute bottom-0 transition-all duration-700 ease-in-out"
                style={{
                  left: "310px",
                  width: "140px",
                  height: "230px",
                  zIndex: 4,
                  borderRadius: "70px 70px 0 0",
                  transform:
                    password.length > 0 && showPassword
                      ? "skewX(0deg)"
                      : `skewX(${yellowPos.bodySkew || 0}deg)`,
                  transformOrigin: "bottom center",
                }}
              >
                <div
                  className="absolute flex gap-6 transition-all duration-200 ease-out"
                  style={{
                    left:
                      password.length > 0 && showPassword
                        ? "20px"
                        : `${52 + (yellowPos.faceX || 0)}px`,
                    top:
                      password.length > 0 && showPassword
                        ? "35px"
                        : `${40 + (yellowPos.faceY || 0)}px`,
                  }}
                >
                  <Pupil
                    size={12}
                    forceLookX={password.length > 0 && showPassword ? -5 : undefined}
                    forceLookY={password.length > 0 && showPassword ? -4 : undefined}
                  />
                  <Pupil
                    size={12}
                    forceLookX={password.length > 0 && showPassword ? -5 : undefined}
                    forceLookY={password.length > 0 && showPassword ? -4 : undefined}
                  />
                </div>
                <div
                  className="absolute h-[4px] w-20 rounded-full bg-[#2D2D2D] transition-all duration-200 ease-out"
                  style={{
                    left:
                      password.length > 0 && showPassword
                        ? "10px"
                        : `${40 + (yellowPos.faceX || 0)}px`,
                    top:
                      password.length > 0 && showPassword
                        ? "88px"
                        : `${88 + (yellowPos.faceY || 0)}px`,
                  }}
                />
              </div>
            </div>
          </div>
        </section>

        {/* 右侧：春纸表单 */}
        <section className="spring-login-right">
          <div className="spring-login-grain" aria-hidden="true" />
          <div className="spring-frame-corners" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </div>
          <div className="spring-login-watermark" aria-hidden="true">
            春
          </div>
          <SpringPlumBranch className="spring-plum-login" />
          <SpringPalaceLantern className="spring-login-mini-lantern top-0" delay={1.4} />
          <SpringCloud className="spring-login-cloud" />
          <SpringCloud className="spring-login-cloud-right" />
          <SpringCloud className="spring-mobile-bottom-cloud" />

          <div className="spring-mobile-hero">
            <SpringLantern className="spring-mobile-lantern top-0" delay={0.9} />
            <SpringCloud className="spring-mobile-cloud" />
            <div className="spring-mobile-hero-inner">
              <div className="flex items-center gap-3">
                <span className="spring-brand-mark" aria-hidden="true">
                  AI
                </span>
                <div>
                  <div className="spring-brand-name">AI 创意工作台</div>
                  <div className="spring-brand-sub">新春纳福 · 灵感常新</div>
                </div>
              </div>
            </div>
            <div className="spring-mobile-hero-title">二〇二七 · 新春快乐</div>
            <div className="spring-mobile-hero-desc">
              随心的 AI 工作空间，助你的想象插上翅膀
            </div>
          </div>

          <div className="spring-login-main">
            <div className="spring-login-card">
              <SpringSeal className="spring-card-seal">春</SpringSeal>
              <p className="spring-card-overline">二〇二七 · 新春</p>
              <h1 className="spring-card-title">欢迎回来</h1>
              <div className="spring-card-rule" aria-hidden="true">
                <span />
                <i />
                <span />
              </div>
              <p className="spring-card-sub">AI 时代，创新是唯一生产力</p>

              <form onSubmit={handleSubmit} className="spring-login-form">
                <div>
                  <label htmlFor="password" className="spring-field-label">
                    密码
                  </label>
                  <div className="spring-input-wrap mt-2">
                    <input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      placeholder="请输入密码"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onFocus={() => setIsTyping(true)}
                      onBlur={() => setIsTyping(false)}
                      required
                      aria-invalid={Boolean(error)}
                      autoComplete="current-password"
                      className="spring-password-input"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="spring-eye-button"
                      aria-label={showPassword ? "隐藏密码" : "显示密码"}
                    >
                      {showPassword ? (
                        <EyeOff className="size-5" />
                      ) : (
                        <Eye className="size-5" />
                      )}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="spring-login-error" role="alert">
                    <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border border-current text-[9px] font-black">
                      !
                    </span>
                    <span>{error}</span>
                  </div>
                )}

                <button
                  type="submit"
                  className="spring-login-submit"
                  disabled={isLoading}
                >
                  {isLoading ? "验证中..." : "登录"}
                </button>
              </form>

              <p className="spring-card-blessing">新春快乐 · 万事胜意</p>
            </div>
          </div>

          <footer className="spring-login-footer">
            <div className="spring-legal-links">
              <span>隐私政策</span>
              <i aria-hidden="true" />
              <span>服务条款</span>
              <i aria-hidden="true" />
              <span>联系我们</span>
            </div>
            <SiteFooter className="spring-site-footer" />
          </footer>
        </section>
      </div>
    </div>
  );
}
