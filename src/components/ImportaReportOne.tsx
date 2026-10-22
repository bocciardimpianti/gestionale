import { useRef, useState } from "react";
import { leggiTutto, registra, supabase } from "../supabase";

// Importazione del file preparato dal database di ReportOne (bocciard.mdb):
// completa i rapporti con orari, tariffe, KM, impianto e righe dei materiali, aggiunge quelli mancanti,
// carica firme/foto dei rapporti e le foto dei materiali, crea le tariffe.

interface Immagine { tipo: string; dati: string }
interface RapportoRO {
  numero: number;
  eliminato: boolean;
  cliente: string | null;
  tecnico: string | null;
  righe: Record<string, unknown>[];
  immagini: Record<string, Immagine>;
  [campo: string]: unknown;
}
interface PreventivoRO {
  gguid: string;
  eliminato: boolean;
  cliente: string | null;
  righe: Record<string, unknown>[];
  [campo: string]: unknown;
}
interface DdtRO {
  gguid: string;
  eliminato: boolean;
  fornitore: string | null;
  righe: Record<string, unknown>[];
  [campo: string]: unknown;
}
interface Pacchetto {
  origine: string;
  preventivi?: PreventivoRO[];
  ddt_acquisto?: DdtRO[];
  tariffe: Record<string, unknown>[];
  rapporti: RapportoRO[];
  foto_materiali: (Immagine & { codice_interno: string | null; descrizione: string | null })[];
}

const CAMPI = [
  "data", "ora_inizio", "ora_fine", "ore_pausa", "totale_ore", "km_percorsi", "diritto_chiamata", "tariffa_fissa",
  "tariffa_oraria", "tariffa_km", "tariffa", "iva", "tipo_impianto", "impianto", "marca", "modello", "matricola",
  "tecnico_vecchio", "attivita", "note", "stato", "fatto_conto", "pagata", "data_pagamento", "rif_preventivo",
  "totale_preventivo", "considera_totale_preventivo", "azzera_imponibile", "pagamento_contanti", "imponibile",
];

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();
const blob = (i: Immagine) => {
  const bin = atob(i.dati);
  const b = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) b[k] = bin.charCodeAt(k);
  return new Blob([b], { type: i.tipo });
};

// Esegue le operazioni in parallelo (pochi alla volta) per fare prima senza sovraccaricare il server
async function aGruppi<T>(lista: T[], quanti: number, fn: (x: T, i: number) => Promise<void>, avanzamento: (n: number) => void) {
  let i = 0;
  let fatti = 0;
  await Promise.all(Array.from({ length: quanti }, async () => {
    while (i < lista.length) {
      const k = i++;
      await fn(lista[k], k);
      if (++fatti % 25 === 0) avanzamento(fatti);
    }
  }));
}

export default function ImportaReportOne({ onChiudi, onFinito }: { onChiudi: () => void; onFinito: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [stato, setStato] = useState("");
  const [inCorso, setInCorso] = useState(false);
  const [errori, setErrori] = useState<string[]>([]);

  const importa = async (file: File) => {
    setInCorso(true);
    setErrori([]);
    const err: string[] = [];
    try {
      setStato("Lettura del file…");
      const p = JSON.parse(await file.text()) as Pacchetto;
      p.rapporti ??= [];
      p.tariffe ??= [];
      p.foto_materiali ??= [];
      const preventivi = p.preventivi ?? [];
      const ddt = p.ddt_acquisto ?? [];
      if (p.origine !== "ReportOne") throw new Error("Il file non è un'esportazione di ReportOne preparata per il gestionale");

      // 1. Tariffe
      setStato("Tariffe…");
      if (p.tariffe.length) {
        const { error } = await supabase.from("tariffe").upsert(p.tariffe, { onConflict: "nome" });
        if (error) err.push("Tariffe: " + error.message);
      }

      // 2. Anagrafiche per collegare clienti, tecnici e materiali
      setStato("Lettura di clienti, tecnici, materiali e rapporti esistenti…");
      const [clienti, tecnici, materiali, esistenti] = await Promise.all([
        leggiTutto("clienti", "id, nome"),
        leggiTutto("tecnici", "id, nome"),
        leggiTutto("materiali", "id, codice_interno, descrizione, foto"),
        leggiTutto("rapporti", "id, numero, firma, foto1, foto2, foto3, foto4, eliminato_il"),
      ]);
      const idCliente = new Map(clienti.map((c) => [norm(c.nome), c.id]));
      const idTecnico = new Map(tecnici.map((t) => [norm(t.nome), t.id]));
      const idMateriale = new Map(materiali.filter((m) => m.codice_interno).map((m) => [norm(m.codice_interno), m.id]));
      const perNumero = new Map(esistenti.map((r) => [Number(r.numero), r]));

      // Clienti presenti nei rapporti ma non in anagrafica (es. eliminati in ReportOne): si creano
      const mancanti = [...new Set([...p.rapporti, ...preventivi].map((r) => r.cliente).filter((c): c is string => !!c && !idCliente.has(norm(c))))];
      if (mancanti.length && confirm(`${mancanti.length} clienti dei documenti non sono in anagrafica:\n${mancanti.slice(0, 15).join("\n")}${mancanti.length > 15 ? "\n…" : ""}\n\nVuoi crearli?`)) {
        const { data, error } = await supabase.from("clienti").insert(mancanti.map((nome) => ({ nome }))).select("id, nome");
        if (error) err.push("Clienti: " + error.message);
        for (const c of data ?? []) idCliente.set(norm(c.nome), c.id);
      }

      // 3. Rapporti: aggiornamento di quelli esistenti (per numero) e creazione dei mancanti
      const nuovi = p.rapporti.filter((r) => !perNumero.has(r.numero)).length;
      if (!confirm(
        "File ReportOne:\n" +
        (p.rapporti.length ? `• ${p.rapporti.length} rapporti: ${p.rapporti.length - nuovi} da completare, ${nuovi} da aggiungere\n` : "") +
        (preventivi.length ? `• ${preventivi.length} preventivi con le loro righe\n` : "") +
        (ddt.length ? `• ${ddt.length} DDT di acquisto con le loro righe (la giacenza dei materiali non cambia)\n` : "") +
        (p.foto_materiali.length ? `• ${p.foto_materiali.length} foto di materiali\n` : "") +
        "\nProcedere?",
      )) {
        setInCorso(false);
        setStato("");
        return;
      }

      const idRapporto = new Map<number, number>();
      await aGruppi(p.rapporti, 6, async (r) => {
        const record: Record<string, unknown> = {};
        for (const c of CAMPI) if (r[c] !== undefined) record[c] = r[c];
        record.cliente_id = r.cliente ? idCliente.get(norm(r.cliente)) ?? null : null;
        record.tecnico_id = r.tecnico ? idTecnico.get(norm(r.tecnico)) ?? null : null;
        const es = perNumero.get(r.numero);
        if (r.eliminato && !es?.eliminato_il) record.eliminato_il = new Date().toISOString();
        const risposta = es
          ? await supabase.from("rapporti").update(record).eq("id", es.id).select("id").single()
          : await supabase.from("rapporti").insert({ ...record, numero: r.numero }).select("id").single();
        if (risposta.error) {
          err.push(`Rapporto ${r.numero}: ${risposta.error.message}`);
          return;
        }
        idRapporto.set(r.numero, risposta.data.id);
      }, (n) => setStato(`Rapporti… ${n} / ${p.rapporti.length}`));

      // 4. Righe dei materiali (non scaricano di nuovo la giacenza: "importata")
      const conRighe = p.rapporti.filter((r) => r.righe.length && idRapporto.has(r.numero));
      await aGruppi(conRighe, 6, async (r) => {
        const id = idRapporto.get(r.numero)!;
        const del = await supabase.from("righe_rapporto").delete().eq("rapporto_id", id);
        if (del.error) return void err.push(`Righe rapporto ${r.numero}: ${del.error.message}`);
        const righe = r.righe.map((x) => ({
          ...x,
          rapporto_id: id,
          materiale_id: x.codice_articolo ? idMateriale.get(norm(x.codice_articolo)) ?? null : null,
          importata: true,
        }));
        const ins = await supabase.from("righe_rapporto").insert(righe);
        if (ins.error) err.push(`Righe rapporto ${r.numero}: ${ins.error.message}`);
      }, (n) => setStato(`Righe dei materiali… ${n} / ${conRighe.length} rapporti`));

      // 5. Firme e foto dei rapporti (solo se il rapporto non ne ha già)
      const conImmagini = p.rapporti.filter((r) => Object.keys(r.immagini).length && idRapporto.has(r.numero));
      await aGruppi(conImmagini, 3, async (r) => {
        const id = idRapporto.get(r.numero)!;
        const es = perNumero.get(r.numero);
        const agg: Record<string, string> = {};
        for (const [campo, img] of Object.entries(r.immagini)) {
          if (es?.[campo]) continue;
          const percorso = `${id}/${campo}-reportone.${img.tipo === "image/png" ? "png" : "jpg"}`;
          const up = await supabase.storage.from("rapporti").upload(percorso, blob(img), { contentType: img.tipo, upsert: true });
          if (up.error) err.push(`Immagine rapporto ${r.numero}: ${up.error.message}`);
          else agg[campo] = percorso;
        }
        if (Object.keys(agg).length) {
          const { error } = await supabase.from("rapporti").update(agg).eq("id", id);
          if (error) err.push(`Immagini rapporto ${r.numero}: ${error.message}`);
        }
      }, (n) => setStato(`Firme e foto dei rapporti… ${n} / ${conImmagini.length}`));

      // 6. Foto dei materiali (solo per i materiali che non ne hanno)
      const perCodiceDescr = new Map(materiali.map((m) => [`${norm(m.codice_interno)}|${norm(m.descrizione)}`, m]));
      const perCodice = new Map(materiali.filter((m) => m.codice_interno).map((m) => [norm(m.codice_interno), m]));
      const daCaricare = p.foto_materiali
        .map((f) => ({ f, m: perCodiceDescr.get(`${norm(f.codice_interno)}|${norm(f.descrizione)}`) ?? (f.codice_interno ? perCodice.get(norm(f.codice_interno)) : undefined) }))
        .filter((x) => x.m && !x.m.foto);
      await aGruppi(daCaricare, 4, async ({ f, m }) => {
        const percorso = `${m!.id}/foto-reportone.${f.tipo === "image/png" ? "png" : "jpg"}`;
        const up = await supabase.storage.from("materiali").upload(percorso, blob(f), { contentType: f.tipo, upsert: true });
        if (up.error) return void err.push(`Foto materiale ${f.codice_interno}: ${up.error.message}`);
        const { error } = await supabase.from("materiali").update({ foto: percorso }).eq("id", m!.id);
        if (error) err.push(`Foto materiale ${f.codice_interno}: ${error.message}`);
      }, (n) => setStato(`Foto dei materiali… ${n} / ${daCaricare.length}`));

      // 7. Preventivi con le righe (riconosciuti dal codice ReportOne: si possono reimportare senza doppioni)
      let preventiviFatti = 0;
      if (preventivi.length) {
        const giaPresenti = await leggiTutto("preventivi", "id, gguid_reportone");
        const perGguid = new Map(giaPresenti.filter((x) => x.gguid_reportone).map((x) => [String(x.gguid_reportone), x.id]));
        const idPerBarre = new Map(materiali.filter((m) => m.codice_interno).map((m) => [norm(m.codice_interno), m.id]));
        await aGruppi(preventivi, 6, async (pv) => {
          const { righe, cliente, gguid, eliminato, ...campi } = pv;
          const record: Record<string, unknown> = { ...campi, gguid_reportone: gguid, cliente_id: cliente ? idCliente.get(norm(cliente)) ?? null : null };
          if (eliminato) record.eliminato_il = new Date().toISOString();
          const es = perGguid.get(gguid);
          const risposta = es
            ? await supabase.from("preventivi").update(record).eq("id", es).select("id").single()
            : await supabase.from("preventivi").insert(record).select("id").single();
          if (risposta.error) return void err.push(`Preventivo ${pv.numero}: ${risposta.error.message}`);
          const id = risposta.data.id;
          const del = await supabase.from("righe_preventivo").delete().eq("preventivo_id", id);
          if (del.error) return void err.push(`Righe preventivo ${pv.numero}: ${del.error.message}`);
          if (righe.length) {
            const ins = await supabase.from("righe_preventivo").insert(righe.map((x) => ({
              ...x, preventivo_id: id, materiale_id: x.codice_barre ? idPerBarre.get(norm(x.codice_barre)) ?? null : null,
            })));
            if (ins.error) return void err.push(`Righe preventivo ${pv.numero}: ${ins.error.message}`);
          }
          preventiviFatti++;
        }, (n) => setStato(`Preventivi… ${n} / ${preventivi.length}`));
      }

      // 8. DDT di acquisto con le righe (riconosciuti dal codice ReportOne); i fornitori mancanti si possono creare
      let ddtFatti = 0;
      if (ddt.length) {
        setStato("Lettura dei fornitori e dei DDT esistenti…");
        const [fornitori, giaPresenti] = await Promise.all([leggiTutto("fornitori", "id, nome"), leggiTutto("ddt_acquisto", "id, gguid_reportone")]);
        const idFornitore = new Map(fornitori.map((f) => [norm(f.nome), f.id]));
        const fornMancanti = [...new Map(ddt.filter((d) => d.fornitore && !idFornitore.has(norm(d.fornitore))).map((d) => [norm(d.fornitore), d.fornitore!])).values()];
        if (fornMancanti.length && confirm(`${fornMancanti.length} fornitori dei DDT non sono in anagrafica:\n${fornMancanti.slice(0, 15).join("\n")}${fornMancanti.length > 15 ? "\n…" : ""}\n\nVuoi crearli?`)) {
          const { data, error } = await supabase.from("fornitori").insert(fornMancanti.map((nome) => ({ nome }))).select("id, nome");
          if (error) err.push("Fornitori: " + error.message);
          for (const f of data ?? []) idFornitore.set(norm(f.nome), f.id);
        }
        const perGguid = new Map(giaPresenti.filter((x) => x.gguid_reportone).map((x) => [String(x.gguid_reportone), x.id]));
        const idPerCodice = new Map(materiali.filter((m) => m.codice_interno).map((m) => [norm(m.codice_interno), m.id]));
        await aGruppi(ddt, 6, async (d) => {
          const { righe, fornitore, gguid, eliminato, ...campi } = d;
          const record: Record<string, unknown> = { ...campi, gguid_reportone: gguid, fornitore_id: fornitore ? idFornitore.get(norm(fornitore)) ?? null : null };
          if (eliminato) record.eliminato_il = new Date().toISOString();
          const es = perGguid.get(gguid);
          const risposta = es
            ? await supabase.from("ddt_acquisto").update(record).eq("id", es).select("id").single()
            : await supabase.from("ddt_acquisto").insert(record).select("id").single();
          if (risposta.error) return void err.push(`DDT ${d.numero}: ${risposta.error.message}`);
          const id = risposta.data.id;
          const del = await supabase.from("righe_ddt_acquisto").delete().eq("ddt_id", id);
          if (del.error) return void err.push(`Righe DDT ${d.numero}: ${del.error.message}`);
          if (righe.length) {
            const ins = await supabase.from("righe_ddt_acquisto").insert(righe.map((x) => ({
              ...x, ddt_id: id, materiale_id: x.codice_barre ? idPerCodice.get(norm(x.codice_barre)) ?? null : null,
            })));
            if (ins.error) return void err.push(`Righe DDT ${d.numero}: ${ins.error.message}`);
          }
          ddtFatti++;
        }, (n) => setStato(`DDT di acquisto… ${n} / ${ddt.length}`));
      }

      await registra("rapporti_importato_reportone", {
        file: file.name, rapporti: idRapporto.size, nuovi, righe: conRighe.length, foto_materiali: daCaricare.length, errori: err.length,
      });
      setStato(
        `Importazione completata: ${idRapporto.size} rapporti (${nuovi} nuovi), materiali in ${conRighe.length} rapporti, ` +
        `${conImmagini.length} rapporti con firme/foto, ${daCaricare.length} foto di materiali, ${p.tariffe.length} tariffe, ${preventiviFatti} preventivi, ${ddtFatti} DDT di acquisto.` +
        (err.length ? ` ${err.length} errori (vedi sotto).` : ""),
      );
      setErrori(err);
      onFinito();
    } catch (e) {
      setStato("Errore: " + (e as Error).message);
    }
    setInCorso(false);
  };

  return (
    <div className="velo" onMouseDown={() => !inCorso && onChiudi()}>
      <div className="finestra finestra-backup" onMouseDown={(e) => e.stopPropagation()}>
        <div className="finestra-titolo">Importa dati da ReportOne</div>
        <div className="finestra-corpo">
          <p style={{ marginTop: 0 }}>
            Scegli il file preparato dal database di ReportOne (es. <b>"ReportOne - completamento rapporti.json"</b> , <b>"ReportOne - preventivi.json"</b> o <b>"ReportOne - DDT di acquisto.json"</b>).
          </p>
          <p className="piccolo">
            Completa i rapporti con ora inizio e fine, tariffe, KM, impianto e righe dei materiali; aggiunge i rapporti mancanti,
            le tariffe, le firme e foto dei rapporti e le foto dei materiali. Si può ripetere senza creare doppioni.
          </p>
          {stato && <p className={stato.startsWith("Errore") ? "errore" : "ok"}>{stato}</p>}
          {errori.length > 0 && (
            <details>
              <summary className="errore">{errori.length} errori</summary>
              <pre className="piccolo" style={{ maxHeight: 200, overflow: "auto", whiteSpace: "pre-wrap" }}>{errori.join("\n")}</pre>
            </details>
          )}
          <input ref={fileRef} type="file" accept=".json" hidden onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) importa(f);
          }} />
        </div>
        <div className="finestra-piede">
          <button type="button" className="btn grigio" disabled={inCorso} onClick={onChiudi}>Chiudi</button>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn blu" disabled={inCorso} onClick={() => fileRef.current?.click()}>
            {inCorso ? "Importazione in corso…" : "Scegli il file e importa"}
          </button>
        </div>
      </div>
    </div>
  );
}
