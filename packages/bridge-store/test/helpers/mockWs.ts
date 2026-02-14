export class MockWs {
  static OPEN = 1
  OPEN = 1
  readyState = 1
  sent: any[] = []

  send(data: string) {
    this.sent.push(JSON.parse(data))
  }

  close() {
    this.readyState = 3
  }
}
