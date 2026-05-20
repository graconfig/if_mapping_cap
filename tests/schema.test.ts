import cds from '@sap/cds';

test('CDS model loads without errors', async () => {
  const model = await cds.load('db/schema.cds');
  expect(model).toBeDefined();
  const defs = model.definitions!;
  expect(defs['PromptTemplates']).toBeDefined();
  expect(defs['TokenLogs']).toBeDefined();
  expect(defs['external.CdsViews']).toBeDefined();
  expect((defs['external.CdsViews'] as any)['@cds.persistence.exists']).toBe(true);
});
