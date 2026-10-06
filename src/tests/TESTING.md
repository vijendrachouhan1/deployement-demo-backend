# The testing mindset

When you test an API endpoint, think like 4 different users:

- **A happy user** – “Does this work as expected?”
- **A confused user** – “What if I send wrong data?”
- **A malicious user** – “What if I try to break it?”
- **Your future self at 3 AM** – “What if something external fails?”

Every good test suite covers all four.

There are two steps to follow while writing the test cases for an API endpoint

## Step 1: Understanding the API endpoint before writing tests

Points to note

1. Method + Path
2. Auth required(yes / no)
3. Input: body, query, params
4. Output: status code + response data
5. Side effects: DB writes, emails , events, third-party services(mock the side-effects)

Example Endpoint:

1. **POST /users.** Creates a new user
2. Auth required ( No)
3. Body
   1. email (required)
   2. password(required)
4. Success:
   1. 201 Created
5. Failure:
   1. 400 Validation request
   2. 409 User already exists
   3. 500 Internal server error
6. Check whether the user is created in db or not. Welcome email triggered

## Step 2: The core test scenarios

1. ### Happy flow

   This must have a test-case.  
   “Valid input -> correct output”

- Valid request
- Correct status code and response shape
- Side effects happened (DB row created)

  ```ts
  it("creates a user with valid data", async () => {
    const res = await request(app)
      .post("/users")

      .send({ email: "a@test.com", password: "Pass@123" });

    expect(res.status).toBe(201);

    expect(res.body).toHaveProperty("id");
  });
  ```

2. ### Data validation and bad input

   Think: What can go wrong with the input?

   Checklist

- Missing request fields
- Wrong data types
- Empty string
- invalid format(email, phone number)
- Extra unexpected fields

  ```ts
  it("fails if email is missing", async () => {
    const res = await request(app)
      .post("/users")
      .send({ password: "Pass@123" });
    expect(res.status).toBe(400);
  });
  ```

3. ## Auth and Authorization

   Think: No token? Invalid token? expired token? User lacks permission?

```ts
it("rejects unauthenticated requests", async () => {
  const res = await request(app).get("/me");
  expect(res.status).toBe(401);
});
```

4. ## Resource existence(404 and conflicts)

   Think:

- ID doesn’t exist?
- Already exists?
- Deleted resource
- Soft deleted

```ts
it("returns 404 if user not found", async () => {
  const res = await request(app).get("/users/unknown-id");

  expect(res.status).toBe(404);
});
```

5. ## Business requirement

   These are logic specific edge cases. This where real bugs hide

   Ask: Limits (min/max). State transitions. Uniqueness constraints. Time-based rules

   Example: Password too weak. Can’t update verified email . can’t delete active subscription

```typescript
it("prevents duplicate email signup", async () => {
  await createUser("a@test.com");

  const res = await request(app)
    .post("/users")
    .send({ email: "a@test.com", password: "Pass@123" });

  expect(res.status).toBe(409);
});
```

### 5. External failures

Think: DB down? Third part API fails? Timeout? Unexpected error thrown
Mock the failures here

```typescript
it("returns 500 if database fails", async () => {
  vi.spyOn(userRepo, "create").mockRejectedValueOnce(new Error());

  const res = await request(app)
    .post("/users")
    .send({ email: "a@test.com", password: "Pass@123" });

  expect(res.status).toBe(500);
});
```

# Think in status codes

For every endpoint, try to cover:  
| Status | Why |  
| ------ | ----------------- |  
| 2xx | Success |  
| 400 | Bad input |  
| 401 | Not authenticated |  
| 403 | Not authorized |  
| 404 | Resource missing |  
| 409 | Conflict |  
| 500 | Server failure |

if one is not applicable -> skip it

# What NOT to test (important)

Framework internals

- Library behavior (Zod, Joi, bcrypt)
- Happy-path only
- Exact error message strings (brittle)

Focus on:  
✔️ behavior  
✔️ contracts  
✔️ outcomes

# Structure you can follow for clarity

you can adjust it according to the api requirement

```ts
describe("POST /users", () => {
  describe("success", () => {});
  describe("validation errors", () => {});
  describe("auth errors", () => {});
  describe("business scenarios", () => {});
  describe("server errors", () => {});
});
```

# Final checklist

- Happy path tested
- Required fields validated
- Auth & permission tested
- Resource existence tested
- Business rules tested
- Failure paths tested
- Side effects asserted
