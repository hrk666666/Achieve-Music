import React, { useState, useEffect } from "react";

interface SplashScreenProps {
  onDismiss: () => void;
}

const STORAGE_KEY = "achieve_music_splash_seen";

const MUSIC_NOTE_LOGO = (
  <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="logoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#ffffff" />
        <stop offset="100%" stopColor="#a7f3d0" />
      </linearGradient>
    </defs>
    <path
      d="M24 44V14l28-6v30"
      stroke="url(#logoGrad)"
      strokeWidth="4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <ellipse cx="18" cy="46" rx="8" ry="6" fill="url(#logoGrad)" />
    <ellipse cx="46" cy="38" rx="8" ry="6" fill="url(#logoGrad)" />
  </svg>
);

const SplashScreen: React.FC<SplashScreenProps> = ({ onDismiss }) => {
  const [phase, setPhase] = useState<"logo" | "agreement" | "exit">("logo");
  const [agreed, setAgreed] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setPhase("agreement"), 2200);
    const onClick = () => {
      if (phase === "logo") {
        clearTimeout(t);
        setPhase("agreement");
      }
    };
    window.addEventListener("click", onClick);
    return () => {
      clearTimeout(t);
      window.removeEventListener("click", onClick);
    };
  }, [phase]);

  const handleAgree = () => {
    setAgreed(true);
    setPhase("exit");
    setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY, "1"); } catch {}
      onDismiss();
    }, 900);
  };

  return (
    <div
      className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center overflow-hidden transition-opacity duration-700 ${
        phase === "exit" ? "opacity-0 pointer-events-none" : "opacity-100"
      }`}
      style={{
        background: "radial-gradient(ellipse at 30% 20%, #1a1a2e 0%, #0d0d12 60%, #050507 100%)",
      }}
    >
      {/* 背景动态光斑 */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute rounded-full"
          style={{
            width: "600px", height: "600px",
            left: "-10%", top: "-20%",
            background: "radial-gradient(circle, rgba(16,185,129,0.08) 0%, transparent 70%)",
            filter: "blur(80px)",
            animation: "floatA 14s ease-in-out infinite",
          }}
        />
        <div
          className="absolute rounded-full"
          style={{
            width: "500px", height: "500px",
            right: "-5%", bottom: "-15%",
            background: "radial-gradient(circle, rgba(59,130,246,0.06) 0%, transparent 70%)",
            filter: "blur(80px)",
            animation: "floatB 18s ease-in-out infinite",
          }}
        />
      </div>

      {/* Phase 1: Logo + Brand */}
      {phase === "logo" && (
        <div className="relative z-10 text-center animate-[splashLogoIn_1.2s_cubic-bezier(0.22,1,0.36,1)_both]">
          {/* Logo 容器 */}
          <div
            className="mx-auto mb-8 relative"
            style={{ animation: "logoPulse 2.4s ease-in-out 1.2s infinite" }}
          >
            <div
              className="absolute inset-0 rounded-full opacity-40"
              style={{
                background: "radial-gradient(circle, rgba(16,185,129,0.25) 0%, transparent 65%)",
                filter: "blur(20px)",
                transform: "scale(1.8)",
              }}
            />
            <div className="relative w-20 h-20 mx-auto flex items-center justify-center">
              {MUSIC_NOTE_LOGO}
            </div>
          </div>

          {/* Brand Name */}
          <h1
            className="text-white text-[34px] font-light tracking-[0.4em] mb-3"
            style={{ animation: "brandIn 1s cubic-bezier(0.22,1,0.36,1) 0.4s both" }}
          >
            ACHIEVE
          </h1>
          <div
            className="w-10 h-[2px] bg-white/30 mx-auto mb-3"
            style={{ animation: "lineIn 0.8s cubic-bezier(0.22,1,0.36,1) 0.8s both" }}
          />
          <p
            className="text-white/40 text-[11px] tracking-[0.3em] uppercase"
            style={{ animation: "brandIn 1s cubic-bezier(0.22,1,0.36,1) 1s both" }}
          >
            Local Music Player
          </p>
        </div>
      )}

      {/* Phase 2: Agreement Card */}
      {phase === "agreement" && (
        <div className="relative z-10 w-full max-w-md px-6 animate-[cardSlideUp_0.8s_cubic-bezier(0.22,1,0.36,1)_both]">
          <div
            className="rounded-[32px] bg-black/10 backdrop-blur-[100px] saturate-150 border border-white/5 shadow-[0_20px_50px_rgba(0,0,0,0.3)] overflow-hidden max-h-[85vh] flex flex-col"
          >
            {/* Header */}
            <div className="px-7 pt-7 pb-4 shrink-0">
              <h2 className="text-white text-[15px] font-semibold tracking-wide">
                使用前请阅读
              </h2>
              <p className="text-white/35 text-[12px] mt-1">
                继续即表示您已阅读并同意以下条款
              </p>
            </div>

            {/* Agreement List - 可滚动区域 */}
            <div className="flex-1 overflow-y-auto px-5 pb-3 space-y-2 custom-scrollbar">
              <AgreementRow
                title="用户使用协议"
                icon={<DocIcon />}
                defaultExpanded
                content={[
                  "本软件仅供个人学习、研究及非商业娱乐用途。",
                  "您承诺不会将本软件用于任何违反当地法律法规的用途。",
                  "本软件通过合法第三方 API 获取音乐数据，请尊重音乐版权、支持正版。",
                  "开发者不对本软件的稳定性、准确性或可用性做任何明示或暗示的保证。",
                  "您使用本软件即视为同意上述全部条款。",
                ]}
              />
              <AgreementRow
                title="隐私政策"
                icon={<ShieldIcon />}
                defaultExpanded
                content={[
                  "本地存储：播放列表、设置偏好仅保存在您的浏览器 localStorage 中，不会上传任何服务器。",
                  "请求目标：在线音乐请求经本地代理转发至国内音乐平台，数据不出境。",
                  "不收集任何个人信息：无登录、无注册、无埋点、无分析工具。",
                  "第三方 API：音乐平台有其自身隐私政策，请自行查阅。",
                ]}
              />
              <AgreementRow
                title="免责声明"
                icon={<AlertIcon />}
                defaultExpanded
                content={[
                  "音乐版权：音乐版权归原平台及音乐人所有，版权纠纷由使用者自行承担。",
                  "服务可用性：音乐平台 API 可能随时变更或停止服务，不保证长期稳定可用。",
                  "法律法规：使用者须遵守当地法律法规，不得利用本软件从事任何违法违规活动。",
                  "使用风险：本软件按现状提供，开发者不承担任何直接或间接损失。",
                ]}
              />
            </div>

            {/* Checkbox + Button */}
            <div className="px-7 pb-7 pt-3 shrink-0 bg-transparent">
              <label className="flex items-start gap-3 cursor-pointer select-none mb-5 group">
                <span
                  className={`mt-0.5 w-[18px] h-[18px] rounded-[6px] border flex items-center justify-center flex-shrink-0 transition-all duration-200 ${
                    agreed
                      ? "bg-white border-white"
                      : "bg-white/5 border-white/30 group-hover:border-white/50"
                  }`}
                  onClick={(e) => {
                    e.preventDefault();
                    setAgreed(!agreed);
                  }}
                >
                  {agreed && (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6L5 9L10 3" stroke="#0d0d12" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                  className="sr-only"
                />
                <span className={`text-[13px] leading-snug transition-colors ${agreed ? "text-white" : "text-white/50"}`}>
                  我已阅读并同意上述条款
                </span>
              </label>

              <button
                onClick={handleAgree}
                disabled={!agreed}
                className={`w-full py-3.5 rounded-2xl text-[14px] font-medium tracking-wide transition-all duration-300 ${
                  agreed
                    ? "bg-white text-black hover:bg-white/90 active:scale-[0.98] shadow-lg shadow-white/10"
                    : "bg-white/8 text-white/25 cursor-not-allowed"
                }`}
              >
                {agreed ? "开始使用" : "请先勾选同意"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Phase 3: Exit spinner */}
      {phase === "exit" && (
        <div className="relative z-10 text-center animate-[fadeIn_0.4s_both]">
          <div
            className="w-8 h-8 border-2 border-white/15 border-t-white/50 rounded-full mx-auto"
            style={{ animation: "spin 0.8s linear infinite" }}
          />
          <p className="text-white/40 text-[12px] mt-4 tracking-wide">正在启动...</p>
        </div>
      )}

      {/* 全局动画 keyframes */}
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255,255,255,0.12);
          border-radius: 3px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255,255,255,0.22);
        }
        @keyframes splashLogoIn {
          0% { opacity: 0; transform: scale(0.85); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes logoPulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.04); }
        }
        @keyframes brandIn {
          0% { opacity: 0; transform: translateY(8px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes lineIn {
          0% { opacity: 0; width: 0; }
          100% { opacity: 1; width: 40px; }
        }
        @keyframes cardSlideUp {
          0% { opacity: 0; transform: translateY(30px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeIn {
          0% { opacity: 0; }
          100% { opacity: 1; }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes floatA {
          0%, 100% { transform: translate(0, 0); }
          50% { transform: translate(30px, 20px); }
        }
        @keyframes floatB {
          0%, 100% { transform: translate(0, 0); }
          50% { transform: translate(-20px, -30px); }
        }
      `}</style>
    </div>
  );
};

/* ===== 子组件 ===== */

interface AgreementRowProps {
  title: string;
  icon: React.ReactNode;
  defaultExpanded?: boolean;
  content: string[];
}

const AgreementRow: React.FC<AgreementRowProps> = ({ title, icon, defaultExpanded = true, content }) => (
  <div
    className={`rounded-2xl bg-white/5 transition-all duration-300 overflow-hidden`}
  >
    <div className="flex items-center gap-3 px-4 py-2.5">
      <span className="w-8 h-8 rounded-xl bg-white/5 flex items-center justify-center flex-shrink-0">
        {icon}
      </span>
      <span className="flex-1 text-white/85 text-[13px] font-medium">{title}</span>
    </div>
    <div className="px-4 pb-3 text-[12px] leading-relaxed text-white/40">
      <ul className="space-y-1.5">
        {content.map((line, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-white/20 flex-shrink-0">·</span>
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </div>
  </div>
);

/* ===== 纯 SVG icons ===== */

const DocIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M4 1.5H9.5L12 4V14.5H4V1.5Z" stroke="rgba(255,255,255,0.5)" strokeWidth="1.2" strokeLinejoin="round" />
    <path d="M9.5 1.5V4H12" stroke="rgba(255,255,255,0.5)" strokeWidth="1.2" strokeLinejoin="round" />
    <path d="M6.5 7.5H10M6.5 10H10M6.5 12.5H8.5" stroke="rgba(255,255,255,0.3)" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);

const ShieldIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M8 1.5L13 3.5V8C13 11 10.5 13.5 8 14.5C5.5 13.5 3 11 3 8V3.5L8 1.5Z" stroke="rgba(255,255,255,0.5)" strokeWidth="1.2" strokeLinejoin="round" />
    <path d="M5.5 8L7.5 10L10.5 6" stroke="rgba(255,255,255,0.3)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const AlertIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M8 1.5L14 13.5H2L8 1.5Z" stroke="rgba(255,255,255,0.5)" strokeWidth="1.2" strokeLinejoin="round" />
    <path d="M8 6V9.5" stroke="rgba(255,255,255,0.3)" strokeWidth="1.2" strokeLinecap="round" />
    <circle cx="8" cy="11.5" r="0.8" fill="rgba(255,255,255,0.3)" />
  </svg>
);

export default SplashScreen;
