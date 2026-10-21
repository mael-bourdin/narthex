import { useEffect, useState } from "react";

/**
 * Margaux offers WhatsApp at the end of the first launch: two choices, then, if the founder wants
 * it, the QR code to scan (WhatsApp › Appareils connectés). The risk is said before anything happens.
 */
export function WhatsAppChoice({ onChoose }: { onChoose(connect: boolean): void }) {
  return (
    <div className="seuil-choices">
      <button className="seuil-choice primary" autoFocus onClick={() => onChoose(true)}>
        Connecter WhatsApp
      </button>
      <button className="seuil-choice" onClick={() => onChoose(false)}>
        Plus tard
      </button>
    </div>
  );
}

export function WhatsAppQr({ risk, onCancel }: { risk: string; onCancel(): void }) {
  const [svg, setSvg] = useState<string>();
  useEffect(() => window.narthex.whatsapp.onQr(setSvg), []);
  return (
    <div className="seuil-qr">
      {/* The SVG is drawn by the qrcode library in the main process, from wacli's QR payload. */}
      {svg ? <div className="seuil-qr-code" dangerouslySetInnerHTML={{ __html: svg }} /> : <div className="seuil-qr-code waiting">…</div>}
      <p>
        Sur ton téléphone : WhatsApp › <strong>Appareils connectés</strong> › Connecter un appareil.
      </p>
      <p className="seuil-qr-risk">{risk}</p>
      <button className="seuil-choice" onClick={onCancel}>
        Annuler
      </button>
    </div>
  );
}
