import { useEffect, useState } from "react";
import { createBaseAccountSDK } from "@base-org/account";
import { ethers } from "ethers";
import { baseSepolia } from "viem/chains";
import powellImg from "./assets/powell.png";
import "./App.css";

const CONTRACT_ADDRESS = "0x162316f84Cb8A3c981cC2cF150D4240EfEE2CeE1";
const CONTRACT_ABI = [
  "function rateBps() view returns (uint256)",
  "function totalPresses() view returns (uint256)",
  "function press() public",
];

export default function App() {
  const [provider, setProvider] = useState(null);   // EIP-1193 из Base SDK
  const [account, setAccount] = useState(null);     // показ в UI
  const [rate, setRate] = useState(null);
  const [presses, setPresses] = useState(null);
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(false);

  // Инициализация Base SDK (Sub Accounts: авто-создание и использование)
  useEffect(() => {
    const init = async () => {
      const sdk = createBaseAccountSDK({
        appName: "Beat Powell",
        appLogoUrl: "https://base.org/logo.png",
        appChainIds: [baseSepolia.id],
        subAccounts: {
          creation: "on-connect",
          defaultAccount: "sub",
        },
      });
      setProvider(sdk.getProvider());
    };
    init();
  }, []);

  // Подключение (всплывёт окно Base Account, суб создастся автоматически)
  const connectWallet = async () => {
    if (!provider) return alert("Provider not ready yet");
    const accounts = await provider.request({ method: "eth_requestAccounts" });
    setAccount(accounts?.[0] ?? null);
    // подстрахуемся: в каждой сессии подключим/создадим суб-акк
    try {
      await provider.request({
        method: "wallet_addSubAccount",
        params: [{ account: { type: "create" } }],
      });
    } catch {}
    await loadData();
  };

  const getContract = async () => {
    const ethersProvider = new ethers.BrowserProvider(provider);
    const signer = await ethersProvider.getSigner();
    return new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
  };

  const loadData = async () => {
    try {
      if (!provider) return;
      const c = await getContract();
      const rateRaw = await c.rateBps();        // bigint
      const pressesRaw = await c.totalPresses();// bigint
      setRate(Number(rateRaw) / 100);           // 425 -> 4.25
      setPresses(Number(pressesRaw));
    } catch (e) {
      console.error("loadData error:", e);
    }
  };

  const handlePress = async () => {
    try {
      setLoading(true);
      setShake(true);
      setTimeout(() => setShake(false), 500);

      const c = await getContract();
      const tx = await c.press();  // поп-ап подтверждения (пока без auto-spend)
      await tx.wait();
      await loadData();
    } catch (e) {
      console.error("TX error:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (account && provider) loadData();
  }, [account, provider]);

  // ширина прогресс-бара: считаем от 0% до 5% для красивой шкалы
  const progressWidth = rate != null ? Math.max(0, Math.min(100, (rate / 5) * 100)) : 0;

  return (
    <div className="app">
      <h1 className="title">💼 Beat Powell</h1>
      <p className="subtitle">Use Base Sub-Accounts to lower the rate onchain</p>

      {!account ? (
        <>
          <button className="connect-btn" onClick={connectWallet}>
            Connect / Create Base Sub-Account
          </button>
          <p className="hint">No Coinbase exchange account needed — passkey smart wallet.</p>
        </>
      ) : (
        <>
          {/* Powell art */}
          <div className={`powell ${shake ? "shake" : ""}`}>
            <div className="powell-glow">
              <img src={powellImg} alt="Powell" className="powell-img" />
            </div>
          </div>

          {/* Rate display */}
          <div className="rate-box">
            <div className="rate-label">Interest Rate:</div>
            <div className="rate-value">
              {rate != null ? `${rate.toFixed(2)}%` : "..."}
            </div>

            <div className="rate-bar">
              <div className="rate-progress" style={{ width: `${progressWidth}%` }} />
            </div>
          </div>

          <p className="clicks">Total Clicks: {presses ?? "..."}</p>

          <button
            className={`press-btn ${loading ? "loading" : ""}`}
            onClick={handlePress}
            disabled={loading}
          >
            {loading ? "Processing..." : "CLICK TO LOWER RATES"}
          </button>

          <p className="address">
            Connected: {account.slice(0, 6)}…{account.slice(-4)}
          </p>
        </>
      )}
    </div>
  );
}
