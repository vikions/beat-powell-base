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
const WRITE_ABI = ["function press()"];
const BASE_SEPOLIA_CHAIN_ID_HEX = "0x14A34"; // 84532

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
    } catch {}
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return { ok: false, error: new Error("Timeout waiting for confirmation") };
}

export default function App() {
  const [provider, setProvider] = useState(null);

  // Храним адреса отдельно и явно
  const [universalAddress, setUniversalAddress] = useState(null);
  const [subAddress, setSubAddress] = useState(null);

  const [rate, setRate] = useState(null);
  const [presses, setPresses] = useState(null);
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(false);

  useEffect(() => {
    const init = async () => {
      const sdk = createBaseAccountSDK({
        appName: "Beat Powell",
        appLogoUrl: "https://base.org/logo.png",
        appChainIds: [baseSepolia.id],
        subAccounts: {
          creation: "on-connect",
          defaultAccount: "sub",
          funding: "manual",  

        
        },
      });
      setProvider(sdk.getProvider());
    };
    init();
  }, []);

  // Получить/создать sub для ТЕКУЩЕГО домена
  const ensureSubForDomain = async (univ) => {
    // пробуем найти sub, привязанный к origin
    const res = await provider.request({
      method: "wallet_getSubAccounts",
      params: [
        {
          account: univ,
          domain: window.location.origin, // критично!
        },
      ],
    });

    let sub = res?.subAccounts?.[0]?.address;

    // если нет — создать
    if (!sub) {
      const created = await provider.request({
        method: "wallet_addSubAccount",
        params: [{ account: { type: "create" } }],
      });
      sub = created?.address;
    }
    return sub;
  };

  const connectWallet = async () => {
    if (!provider) return alert("Provider not ready yet");

    // 1) Авторизуемся — получим универсальный
    const accounts = await provider.request({ method: "eth_requestAccounts" });
    const univ = accounts?.[0] || null;
    setUniversalAddress(univ);

    // 2) Подтянем/создадим sub именно для ЭТОГО домена
    const sub = await ensureSubForDomain(univ);
    setSubAddress(sub);

    await loadData();
  };

  const getReadContract = async () => {
    const ethersProvider = new ethers.BrowserProvider(provider);
    const signer = await ethersProvider.getSigner(); // для удобного call
    return new ethers.Contract(CONTRACT_ADDRESS, READ_ABI, signer);
  };

  const loadData = async () => {
    try {
      if (!provider) return;
      const c = await getReadContract();
      const rateRaw = await c.rateBps();
      const pressesRaw = await c.totalPresses();
      setRate(Number(rateRaw) / 100);
      setPresses(Number(pressesRaw));
    } catch (e) {
      console.error("loadData error:", e);
    }
  };

  const handlePress = async () => {
    try {
      if (!subAddress && !universalAddress) return;
      setLoading(true);
      setShake(true);
      setTimeout(() => setShake(false), 500);

      const from = subAddress || universalAddress;

      const iface = new ethers.Interface(WRITE_ABI);
      const data = iface.encodeFunctionData("press", []);

      const res = await provider.request({
        method: "wallet_sendCalls",
        params: [
          {
            version: "2.0.0",
            atomicRequired: true,
            chainId: BASE_SEPOLIA_CHAIN_ID_HEX,
            from,
            calls: [{ to: CONTRACT_ADDRESS, data, value: "0x0" }],
            // capabilities: { paymasterUrl: "..." } // опц.
          },
        ],
      });

      const id = res?.id || res;
      const mined = await waitForCallsMined(provider, id);
      if (!mined.ok) {
        console.warn("Calls status:", mined);
      } else {
        console.log("CONFIRMED:", mined.txHash);
      }

      await loadData();
    } catch (e) {
      console.error("TX error:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if ((subAddress || universalAddress) && provider) loadData();
  }, [subAddress, universalAddress, provider]);

  const progressWidth =
    rate != null ? Math.max(0, Math.min(100, (rate / 5) * 100)) : 0;

  const connected = subAddress || universalAddress;

  return (
    <div className="app">
      <h1 className="title">💼 Beat Powell</h1>
      <p className="subtitle">Use Base Sub-Accounts to lower the rate onchain</p>

      {!connected ? (
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
            <div className="rate-value">{rate != null ? `${rate.toFixed(2)}%` : "..."}</div>
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
            Universal: {universalAddress ? `${universalAddress.slice(0,6)}…${universalAddress.slice(-4)}` : "—"}
          </p>
          <p className="address">
            Sub (active): {subAddress ? `${subAddress.slice(0,6)}…${subAddress.slice(-4)}` : "—"}
          </p>
        </>
      )}
    </div>
  );
}
