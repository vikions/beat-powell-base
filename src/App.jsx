import { useEffect, useState } from "react";
import { createBaseAccountSDK } from "@base-org/account";
import { ethers } from "ethers";
import { baseSepolia } from "viem/chains";
import powellImg from "./assets/powell.png";
import "./App.css";

const CONTRACT_ADDRESS = "0x162316f84Cb8A3c981cC2cF150D4240EfEE2CeE1";

// чтение/запись для вашего контракта
const READ_ABI = [
  "function rateBps() view returns (uint256)",
  "function totalPresses() view returns (uint256)",
];
const WRITE_ABI = ["function press()"];

// минимальный ERC20 ABI
const ERC20_ABI = ["function transfer(address to, uint256 value) returns (bool)"];

// Base Sepolia (84532) в hex
const CHAIN_ID_HEX = "0x14A34";

// env — адрес тестового USDC и казначейства
const USDC_ADDRESS = import.meta.env.VITE_USDC_ADDRESS;         // напр. 0x...
const TREASURY_ADDRESS = import.meta.env.VITE_TREASURY_ADDRESS; // напр. твой universal

// 0.1 USDC при 6 decimals
const USDC_DECIMALS = 6n;
const USDC_PRICE = 1n * 10n ** (USDC_DECIMALS - 1n); // 0.1 -> 100000

async function waitForCallsMined(provider, id, { pollMs = 900, maxTries = 60 } = {}) {
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
  return { ok: false, error: new Error("Timeout") };
}

export default function App() {
  const [provider, setProvider] = useState(null);
  const [universalAddress, setUniversalAddress] = useState(null);
  const [subAddress, setSubAddress] = useState(null);

  const [rate, setRate] = useState(null);
  const [presses, setPresses] = useState(null);
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(false);
  const [msg, setMsg] = useState("");

  // init SDK c явным funding: 'spend-permissions'
  useEffect(() => {
    const init = async () => {
      const sdk = createBaseAccountSDK({
        appName: "Beat Powell",
        appLogoUrl: "https://base.org/logo.png",
        appChainIds: [baseSepolia.id],
        subAccounts: {
          creation: "on-connect",
          defaultAccount: "sub",
          funding: "spend-permissions", // 🔥 авто-спенд с universal
        },
      });
      setProvider(sdk.getProvider());
    };
    init();
  }, []);

  // находим/создаём sub именно для текущего origin
  const ensureSubForDomain = async (univ) => {
    const res = await provider.request({
      method: "wallet_getSubAccounts",
      params: [{ account: univ, domain: window.location.origin }],
    });
    let sub = res?.subAccounts?.[0]?.address;
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
    setMsg("");
    const accounts = await provider.request({ method: "eth_requestAccounts" });
    const univ = accounts?.[0] || null;
    setUniversalAddress(univ);
    const sub = await ensureSubForDomain(univ);
    setSubAddress(sub);
    await loadData();
  };

  const getReadContract = async () => {
    const ethersProvider = new ethers.BrowserProvider(provider);
    const signer = await ethersProvider.getSigner();
    return new ethers.Contract(CONTRACT_ADDRESS, READ_ABI, signer);
  };

  const loadData = async () => {
    try {
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
      if (!provider) return;
      if (!subAddress && !universalAddress) return;
      if (!USDC_ADDRESS) {
        return alert("VITE_USDC_ADDRESS не задан");
      }

      setLoading(true);
      setMsg("");
      setShake(true);
      setTimeout(() => setShake(false), 500);

      const from = subAddress || universalAddress;

      // calldata для press()
      const pressIface = new ethers.Interface(WRITE_ABI);
      const pressData = pressIface.encodeFunctionData("press", []);

      // calldata для USDC.transfer(treasury, 0.1 USDC)
      const usdcIface = new ethers.Interface(ERC20_ABI);
      const treasury = TREASURY_ADDRESS || universalAddress; // по умолчанию — universal
      const usdcData = usdcIface.encodeFunctionData("transfer", [
        treasury,
        USDC_PRICE,
      ]);

      const res = await provider.request({
        method: "wallet_sendCalls",
        params: [
          {
            version: "2.0.0",
            atomicRequired: true,
            chainId: CHAIN_ID_HEX,
            from,
            calls: [
              { to: CONTRACT_ADDRESS, data: pressData, value: "0x0" }, // ваш удар
              { to: USDC_ADDRESS, data: usdcData, value: "0x0" },       // плата 0.1 USDC
            ],
          },
        ],
      });

      const id = res?.id || res;
      const mined = await waitForCallsMined(provider, id);
      if (!mined.ok) setMsg("Transaction failed/reverted");
      await loadData();
    } catch (e) {
      console.error(e);
      setMsg(e?.message || "TX error");
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
      <p className="subtitle">
        Use Base Sub-Accounts to lower the rate onchain
      </p>

      {!connected ? (
        <>
          <button className="connect-btn" onClick={connectWallet}>
            Connect / Create Base Sub-Account
          </button>
          <p className="hint">
            Price per hit: <b>0.1 USDC</b> • Auto Spend enabled
          </p>
        </>
      ) : (
        <>
          <div className={`powell ${shake ? "shake" : ""}`}>
            <div className="powell-glow">
              <img src={powellImg} alt="Powell" className="powell-img" />
            </div>
          </div>

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
            {loading ? "Processing..." : "PAY 0.1 USDC & HIT POWELL"}
          </button>

          {msg && <p className="hint" style={{ color: "#f66" }}>{msg}</p>}

          <p className="address">
            Universal:{" "}
            {universalAddress
              ? `${universalAddress.slice(0, 6)}…${universalAddress.slice(-4)}`
              : "—"}
          </p>
          <p className="address">
            Sub (active):{" "}
            {subAddress
              ? `${subAddress.slice(0, 6)}…${subAddress.slice(-4)}`
              : "—"}
          </p>
        </>
      )}
    </div>
  );
}
