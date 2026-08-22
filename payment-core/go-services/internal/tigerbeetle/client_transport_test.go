package tigerbeetle

import (
	"encoding/binary"
	"io"
	"net"
	"testing"
)

type shortWriteConn struct{ net.Conn }

func (c shortWriteConn) Write(p []byte) (int, error) {
	if len(p) > 1 { p = p[:1] }
	return c.Conn.Write(p)
}

func TestWriteFullHandlesShortWrites(t *testing.T) {
	server, client := net.Pipe()
	defer server.Close(); defer client.Close()
	want := []byte("complete-packet")
	done := make(chan error, 1)
	go func() { got := make([]byte, len(want)); _, err := io.ReadFull(server, got); if err == nil && string(got) != string(want) { err = io.ErrUnexpectedEOF }; done <- err }()
	if err := writeFull(shortWriteConn{client}, want); err != nil { t.Fatal(err) }
	if err := <-done; err != nil { t.Fatal(err) }
}

func TestSendRequestHandlesFragmentedResponse(t *testing.T) {
	server, client := net.Pipe()
	defer server.Close(); defer client.Close()
	go func() {
		req := make([]byte, 5); _, _ = io.ReadFull(server, req)
		requestLength := binary.LittleEndian.Uint32(req[1:])
		if requestLength > 0 { _, _ = io.CopyN(io.Discard, server, int64(requestLength)) }
		body := []byte("response")
		header := make([]byte, 5); header[0] = 1; binary.LittleEndian.PutUint32(header[1:], uint32(len(body)))
		for _, b := range append(header, body...) { _, _ = server.Write([]byte{b}) }
	}()
	got, err := (&Client{}).sendRequest(nil, shortWriteConn{client}, OperationLookupAccounts, []byte("x"))
	if err != nil { t.Fatal(err) }
	if string(got) != "response" { t.Fatalf("response=%q", got) }
}

func TestSendRequestRejectsOversizedResponse(t *testing.T) {
	server, client := net.Pipe()
	defer server.Close(); defer client.Close()
	go func() {
		req := make([]byte, 5); _, _ = io.ReadFull(server, req)
		requestLength := binary.LittleEndian.Uint32(req[1:])
		if requestLength > 0 { _, _ = io.CopyN(io.Discard, server, int64(requestLength)) }
		header := make([]byte, 5); binary.LittleEndian.PutUint32(header[1:], uint32(MaxResponseSize+1)); _, _ = server.Write(header)
	}()
	_, err := (&Client{}).sendRequest(nil, client, OperationLookupAccounts, []byte("x"))
	if err == nil { t.Fatal("expected oversized response rejection") }
}
