import { useEffect, useState } from "react";
import { createBaseAccountSDK } from "@base-org/account";
import { ethers } from "ethers";
import { baseSepolia } from "viem/chains";
import powellImg from "./assets/powell.png";
import "./App.css";

const CONTRACT_ADDRESS = "0x162316f84Cb8A3c981cC2cF150D4240EfEE2CeE1";
const READ_ABI = [
  "function rateBps() view returns (uint256)",
  "function totalPresses() view returns (uint256)",
];
const WRITE_ABI = ["function press()"]; // для кодирования calldata
const BASE_SEPOLIA_CHAIN_ID_HEX = "0x14A34"; // 84532

// Ждём пока Calls дойдут до CONFIRMED
async function waitForCallsMined(provider, id, { pollMs = 1000, maxTries = 60 } = {}) {
  for (let i = 0; i < maxTries; i++) {
    try {
      const status = await provider.request({
        method: "wallet_getCallsStatus",
        params: [{ id }],
      });
      if (status?.status === "CONFIRMED") {
        const txHash =
          status?.transactions?.[0]?.hash ||
          status?.txHash ||
          status?.transactionHash ||
          null;
        return { ok: true, txHash, raw: status };
      }
      if (status?.status === "FAILED" || status?.status === "REJECTED") {
        return { ok: false, error: status };
      }
    } catch {
      // метод может быть не сразу доступен — просто подождём
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return { ok: false, error: new Error("Timeout waiting for confirmation") };
}

export default function App() {
  const [provider, setProvider] = useState(null);   // EIP-1193 из Base SDK
  const [account, setAccount] = useState(null);     // показываем именно Sub, если он есть
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

  // Подключение (создаст/подключит саб, затем берём пары [universal, sub])
  const connectWallet = async () => {
    if (!provider) return alert("Provider not ready yet");

    await provider.request({ method: "eth_requestAccounts" });

    try {
      // гарантия, что суб-акк есть в текущей сессии (не создаст повторно)
      await provider.request({
        method: "wallet_addSubAccount",
        params: [{ account: { type: "create" } }],
      });
    } catch {}

    const [univ, sub] = await provider.request({ method: "eth_accounts", params: [] });
    setAccount(sub || univ || null);

    await loadData();
  };

  // Read-only контракт через ethers для UI
  const getReadContract = async () => {
    const ethersProvider = new ethers.BrowserProvider(provider);
    const signer = await ethersProvider.getSigner(); // signer только для удобства
    return new ethers.Contract(CONTRACT_ADDRESS, READ_ABI, signer);
  };

  const loadData = async () => {
    try {
      if (!provider) return;
      const c = await getReadContract();
      const rateRaw = await c.rateBps();         // bigint
      const pressesRaw = await c.totalPresses(); // bigint
      setRate(Number(rateRaw) / 100);            // 425 -> 4.25
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

      // адреса: [universal, sub]; используем именно sub, если он есть
      const [univ, sub] = await provider.request({ method: "eth_accounts", params: [] });
      const from = sub || univ;

      // calldata для press()
      const iface = new ethers.Interface(WRITE_ABI);
      const data = iface.encodeFunctionData("press", []);

      // Отправка через EIP-5792 v2.0.0 (после выдачи ongoing permissions — без поп-апов)
      const res = await provider.request({
        method: "wallet_sendCalls",
        params: [
          {
            version: "2.0.0",
            atomicRequired: true,
            chainId: BASE_SEPOLIA_CHAIN_ID_HEX,
            from,
            calls: [{ to: CONTRACT_ADDRESS, data, value: "0x0" }],
            // capabilities: { paymasterUrl: "..." } // можно добавить позже
          },
        ],
      });

      const id = res?.id || res;
      const mined = await waitForCallsMined(provider, id);

      if (!mined.ok) {
        console.warn("Calls status:", mined);
        // опциональный фолбэк на обычную транзу (оставлю закомментированным)
        // const ethersProvider = new ethers.BrowserProvider(provider);
        // const signer = await ethersProvider.getSigner(from);
        // const txHash = await provider.request({
        //   method: "eth_sendTransaction",
        //   params: [{ from, to: CONTRACT_ADDRESS, data, value: "0x0" }],
        // });
        // console.log("Fallback txHash:", txHash);
      } else {
        console.log("CONFIRMED. txHash:", mined.txHash);
      }

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
  const progressWidth =
    rate != null ? Math.max(0, Math.min(100, (rate / 5) * 100)) : 0;

  return (
    <div className="app">
      <h1 className="title">💼 Beat Powell</h1>
      <p className="subtitle">Use Base Sub-Accounts to lower the rate onchain</p>

      {!account ? (
        <>
          <button className="connect-btn" onClick={connectWallet}>
            Connect / Create Base Sub-Account
          </button>
          <p className="hint">
            No Coinbase exchange account needed — passkey smart wallet.
          </p>
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
              <div
                className="rate-progress"
                style={{ width: `${progressWidth}%` }}
              />
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
            Sending from (Sub if present): {account.slice(0, 6)}…{account.slice(-4)}
          </p>
        </>
      )}
    </div>
  );
}
