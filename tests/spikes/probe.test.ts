import { describe, it, expect } from 'vitest';
import { evaluateProbes } from '../../spikes/phase0/probe';

const ping = (o: Record<string, unknown>) => JSON.stringify({ php: '8.5.0', sodium: true, basic_auth_seen: true, sensei: '4.26.4', certificates: '2.6.0', ...o });

describe('evaluateProbes', () => {
  it('fails wp-json-through-rewrites when /wp-json/ returns the app shell', () => {
    const r = evaluateProbes([{ id: 'wp-json-through-rewrites', status: 200, contentType: 'text/html', body: '<div id="app">' }]);
    expect(r[0]).toMatchObject({ id: 'wp-json-through-rewrites', pass: false });
  });
  it('passes wp-json-through-rewrites on JSON from the spike plugin', () => {
    const r = evaluateProbes([{ id: 'wp-json-through-rewrites', status: 200, contentType: 'application/json; charset=UTF-8', body: ping({}) }]);
    expect(r[0].pass).toBe(true);
  });
  it('passes did-json only for application/did+json or application/json with the right id', () => {
    const good = JSON.stringify({ id: 'did:web:lrs.sqwrlz.com' });
    const bad = JSON.stringify({ id: 'did:web:other.example' });
    const run = (contentType: string, body: string, status = 200) =>
      evaluateProbes([{ id: 'did-json', status, contentType, body }])[0].pass;
    expect(run('application/did+json', good)).toBe(true);
    expect(run('application/json; charset=utf-8', good)).toBe(true);
    expect(run('application/json', bad)).toBe(false);
    expect(run('text/html', good)).toBe(false);
    expect(run('application/json', good, 404)).toBe(false);
    expect(run('application/json', '<html>')).toBe(false);
  });
  it('passes certificate-headless only when bytes > 1000 and contentType is application/pdf', () => {
    const run = (bytes: number, contentType: string) =>
      evaluateProbes([{ id: 'certificate-headless', status: 200, bytes, contentType }])[0].pass;
    expect(run(5000, 'application/pdf')).toBe(true);
    expect(run(1000, 'application/pdf')).toBe(false);
    expect(run(5000, 'text/html')).toBe(false);
  });
  it('passes functions-self-fetch only when the inner call returned 200', () => {
    const run = (inner: number) =>
      evaluateProbes([{ id: 'functions-self-fetch', status: 200, contentType: 'application/json', body: JSON.stringify({ status: inner, body: '{}' }) }])[0].pass;
    expect(run(200)).toBe(true);
    expect(run(404)).toBe(false);
  });
  it('passes well-known-oauth only for JSON, not the app shell', () => {
    expect(evaluateProbes([{ id: 'well-known-oauth', status: 200, contentType: 'application/json', body: '{"resource":"x"}' }])[0].pass).toBe(true);
    expect(evaluateProbes([{ id: 'well-known-oauth', status: 200, contentType: 'text/html', body: '<div id="app">' }])[0].pass).toBe(false);
  });
  it('reads sensei, sodium, basic auth and wait-until from their payloads', () => {
    const j = (id: any, body: string) => evaluateProbes([{ id, status: 200, contentType: 'application/json', body }])[0].pass;
    expect(j('sensei-installed', ping({}))).toBe(true);
    expect(j('sensei-installed', ping({ certificates: null }))).toBe(false);
    expect(j('sodium', ping({}))).toBe(true);
    expect(j('sodium', ping({ sodium: false }))).toBe(false);
    expect(j('lrs-host-basic-auth', ping({}))).toBe(true);
    expect(j('lrs-host-basic-auth', ping({ basic_auth_seen: false }))).toBe(false);
    expect(j('functions-wait-until', '{"keys":["params","env","waitUntil"]}')).toBe(true);
    expect(j('functions-wait-until', '{"keys":["params","env"]}')).toBe(false);
  });
  it('passes user-create-route on 201 with a numeric id', () => {
    const run = (status: number, body: string) =>
      evaluateProbes([{ id: 'user-create-route', status, contentType: 'application/json', body }])[0].pass;
    expect(run(201, '{"id":7}')).toBe(true);
    expect(run(401, '{"code":"forbidden"}')).toBe(false);
  });
  it('fails a probe that errored or has no result, and never throws on junk', () => {
    expect(evaluateProbes([{ id: 'sodium', error: 'fetch failed' }])[0]).toMatchObject({ pass: false });
    expect(evaluateProbes([{ id: 'sodium', status: 200, contentType: 'application/json', body: 'nope' }])[0].pass).toBe(false);
  });
});
