import cds from '@sap/cds';

test('CDS model loads without errors', async () => {
  const model = await cds.load('db/schema.cds');
  expect(model).toBeDefined();
  expect(model.definitions['PromptTemplates']).toBeDefined();
  expect(model.definitions['TokenLogs']).toBeDefined();
});
