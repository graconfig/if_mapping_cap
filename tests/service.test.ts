import cds from '@sap/cds';

test('IfMappingService is defined with required actions', async () => {
  const model = await cds.load(['db/schema.cds', 'srv/if-mapping-service.cds']);
  const svc = model.definitions!['IfMappingService'];
  expect(svc).toBeDefined();
  expect(svc.kind).toBe('service');

  const match = model.definitions!['IfMappingService.match'];
  expect(match).toBeDefined();
  expect(match.kind).toBe('action');

  const upload = model.definitions!['IfMappingService.uploadCustomFields'];
  expect(upload).toBeDefined();
});
