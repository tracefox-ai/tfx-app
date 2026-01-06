import { createTeam, getTeam } from '@/controllers/team';
import { clearDBCollections, closeDB, connectDB } from '@/fixtures';

describe('team controller', () => {
  beforeAll(async () => {
    await connectDB();
  });

  afterEach(async () => {
    await clearDBCollections();
  });

  afterAll(async () => {
    await closeDB();
  });

  it('createTeam + getTeam', async () => {
    const team = await createTeam({ name: 'My Team' });

    expect(team.name).toBe('My Team');

    await team.save();

    expect(await getTeam(team._id)).toBeTruthy();
  });
});
